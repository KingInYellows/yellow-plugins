#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function extractIterationGoal(content) {
    const idMatch = content.match(/\*\s+\*\*Iteration ID:\*\*\s+`([^`]+)`/);
    const iterationId = idMatch ? idMatch[1] : "";
    const goalMatch = content.match(/\*\s+\*\*Goal:\*\*\s+(.+?)(?=\n\*|\n\n)/s);
    const iterationGoal = goalMatch ? goalMatch[1].trim() : "";
    return { iterationId, iterationGoal };
}

function parseTask(taskText, iterationId, iterationGoal) {
    const parseBracketedList = (match) => {
        if (!match) return [];
        const raw = match[1];
        const compact = raw.replace(/\n/g, '').replace(/\s+/g, ' ');
        try {
            return JSON.parse(compact);
        } catch (e) {
            const quoted = compact.match(/(["'`])([^"'`]+)\1/g);
            if (quoted) return quoted.map(item => item.slice(1, -1));
            return compact
                .replace(/[\[\]]/g, '')
                .split(',')
                .map(part => part.trim().replace(/^(["'`])|(["'`])$/g, ''))
                .filter(Boolean);
        }
    };

    const task = {
        task_id: "",
        iteration_id: iterationId,
        iteration_goal: iterationGoal,
        description: "",
        agent_type_hint: "",
        inputs: "",
        target_files: [],
        input_files: [],
        deliverables: "",
        acceptance_criteria: "",
        dependencies: [],
        parallelizable: false,
        done: false
    };

    const idMatch = taskText.match(/\*\s+\*\*Task ID:\*\*\s+`([^`]+)`/);
    if (idMatch) task.task_id = idMatch[1];

    const descMatch = taskText.match(/\*\s+\*\*Description:\*\*\s+(.+?)(?=\n\s+\*\s+\*\*|\n\*\s+\*\*)/s);
    if (descMatch) task.description = descMatch[1].trim();

    const agentMatch = taskText.match(/\*\s+\*\*Agent Type Hint:\*\*\s+`([^`]+)`/);
    if (agentMatch) task.agent_type_hint = agentMatch[1];

    const inputsMatch = taskText.match(/\*\s+\*\*Inputs:\*\*\s+(.+?)(?=\n\s+\*\s+\*\*|\n\*\s+\*\*)/s);
    if (inputsMatch) task.inputs = inputsMatch[1].trim();

    const inputFilesMatch = taskText.match(/\*\s+\*\*Input Files:\*\*\s+(\[.+?\])/s);
    task.input_files = parseBracketedList(inputFilesMatch);

    const targetFilesMatch = taskText.match(/\*\s+\*\*Target Files:\*\*\s+(\[.+?\])/s);
    task.target_files = parseBracketedList(targetFilesMatch);

    const delivMatch = taskText.match(/\*\s+\*\*Deliverables:\*\*\s+(.+?)(?=\n\s+\*\s+\*\*|\n\*\s+\*\*)/s);
    if (delivMatch) task.deliverables = delivMatch[1].trim();

    const acceptMatch = taskText.match(/\*\s+\*\*Acceptance Criteria:\*\*\s+(.+?)(?=\n\s+\*\s+\*\*|\n\*\s+\*\*)/s);
    if (acceptMatch) task.acceptance_criteria = acceptMatch[1].trim();

    const depMatch = taskText.match(/\*\s+\*\*Dependencies:\*\*\s+(.+?)(?=\n\s+\*\s+\*\*|\n\*\s+\*\*|\n\n|$)/s);
    if (depMatch) {
        const depText = depMatch[1].trim();
        if (depText.toLowerCase() === "none") {
            task.dependencies = [];
        } else {
            const deps = depText.match(/`([^`]+)`/g);
            task.dependencies = deps ? deps.map(d => d.replace(/`/g, '')) : [];
        }
    }

    const parallelMatch = taskText.match(/\*\s+\*\*Parallelizable:\*\*\s+(Yes|No)/i);
    if (parallelMatch) task.parallelizable = parallelMatch[1].toLowerCase() === "yes";

    return task;
}

function parseIterationFile(filepath) {
    const content = fs.readFileSync(filepath, 'utf-8');
    const { iterationId, iterationGoal } = extractIterationGoal(content);
    const taskPattern = /<!-- anchor: task-[^>]+ -->(.+?)(?=<!-- anchor: task-|$)/gs;
    const taskMatches = [...content.matchAll(taskPattern)];

    const tasks = [];
    for (const match of taskMatches) {
        const task = parseTask(match[1], iterationId, iterationGoal);
        if (task.task_id) tasks.push(task);
    }
    return tasks;
}

function createManifest(outputDir, taskFiles) {
    const manifest = {
        description: "Manifest of all iteration task files",
        total_iterations: taskFiles.length,
        task_files: taskFiles.sort(),
        generated_at: "auto-generated"
    };

    const manifestPath = path.join(outputDir, "tasks_manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`✓ Created manifest: ${manifestPath}`);
}

function main() {
    const planDir = path.join(".codemachine", "artifacts", "plan");
    const outputDir = path.join(".codemachine", "artifacts", "tasks");

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    if (!fs.existsSync(planDir)) {
        console.log("⚠ No iteration files found in .codemachine/artifacts/plan");
        return;
    }

    const iterationFiles = files
        .filter(f => /^02_Iteration_I\d+\.md$/.test(f))
        .sort()
        .map(f => path.join(planDir, f));

    if (iterationFiles.length === 0) {
        console.log("⚠ No iteration files found in .codemachine/artifacts/plan");
        return;
    }

    const taskFiles = [];
    for (const iterationFile of iterationFiles) {
        const tasks = parseIterationFile(iterationFile);
        if (tasks.length === 0) continue;
        const iterationMatch = path.basename(iterationFile).match(/I(\d+)/);
        const outputFilename = iterationMatch ? `tasks_I${iterationMatch[1]}.json` : `tasks_${path.parse(iterationFile).name}.json`;
        const outputPath = path.join(outputDir, outputFilename);
        fs.writeFileSync(outputPath, JSON.stringify(tasks, null, 2));
        taskFiles.push(outputFilename);
    }

    createManifest(outputDir, taskFiles);
    console.log(`✓ Conversion complete! Output is in ${outputDir}`);
}

if (require.main === module) main();
