# NCRS Task Completion Checklist

**Last Updated**: 2025-11-10
**Purpose**: Step-by-step checklist for common development tasks
**System Version**: 2.0.0

---

## Table of Contents

1. [Query Execution Workflow](#query-execution-workflow)
2. [Adding a New Workflow Step](#adding-a-new-workflow-step)
3. [Frontend Visualization Development](#frontend-visualization-development)
4. [Testing Checklist](#testing-checklist)
5. [Deployment Checklist](#deployment-checklist)
6. [Debugging Workflow Issues](#debugging-workflow-issues)
7. [Configuration Updates](#configuration-updates)
8. [Performance Optimization](#performance-optimization)

---

## Query Execution Workflow

### Manual Query Execution (Python API)

- [ ] 1. **Import NCRS facade**
  ```python
  from ncrs import NCRS
  ```

- [ ] 2. **Initialize system**
  ```python
  system = NCRS(data_source='data/')
  ```

- [ ] 3. **Verify dependencies**
  - [ ] Brian2 installed (>=2.5.0)
  - [ ] ConceptNet embeddings present (`data/conceptnet_embeddings.npz` - 1.66GB)
  - [ ] Qwen RPC server running (`localhost:9090`)
  - [ ] CSV data loaded (`data/edges_*.csv`)

- [ ] 4. **Run query**
  ```python
  result = system.run_query(
      query="What causes traffic accidents?",
      max_seeds=50,
      max_workers=8
  )
  ```

- [ ] 5. **Verify result structure**
  - [ ] `result['answer']` - Natural language answer
  - [ ] `result['answer_confidence']` - Confidence score (0.0-1.0)
  - [ ] `result['metrics']` - Performance metrics
  - [ ] `result['paths']` - Explored paths
  - [ ] `result['complete_paths']` - Paths that reached regression

- [ ] 6. **Check metrics**
  ```python
  print(f"LLM calls: {result['llm_calls']}")  # Should be 7-8
  print(f"Total time: {result['total_time_ms']}ms")  # ~1,835ms avg
  print(f"Paths explored: {result['metrics']['num_paths']}")
  print(f"Convergence rate: {result['metrics']['convergence_rate']}")
  ```

### REST API Query Execution

- [ ] 1. **Start FastAPI server**
  ```bash
  uvicorn src.api.main:app --reload --port 8000
  ```

- [ ] 2. **Verify health endpoint**
  ```bash
  curl http://localhost:8000/api/v1/health
  ```

- [ ] 3. **Submit query**
  ```bash
  curl -X POST http://localhost:8000/api/v1/query \
    -H "Content-Type: application/json" \
    -d '{
      "query": "What causes traffic accidents?",
      "max_seeds": 50,
      "max_workers": 8
    }'
  ```

- [ ] 4. **Receive query_id**
  ```json
  { "query_id": "abc123", "status": "processing" }
  ```

- [ ] 5. **Open SSE stream**
  ```bash
  curl http://localhost:8000/api/v1/events?query_id=abc123
  ```

- [ ] 6. **Monitor events**
  - [ ] `step_1_start` - Classification started
  - [ ] `step_1_complete` - Classification complete
  - [ ] `step_2_start` - HyDe started
  - [ ] ...
  - [ ] `workflow_complete` - Final result

---

## Adding a New Workflow Step

### Backend Implementation

- [ ] 1. **Create module directory**
  ```bash
  mkdir -p ncrs/new_step/
  touch ncrs/new_step/__init__.py
  touch ncrs/new_step/step_processor.py
  ```

- [ ] 2. **Define Pydantic schemas**
  ```python
  # ncrs/new_step/models.py
  from pydantic import BaseModel

  class StepInput(BaseModel):
      query: str
      previous_result: dict

  class StepOutput(BaseModel):
      result: dict
      confidence: float
  ```

- [ ] 3. **Implement step processor**
  ```python
  # ncrs/new_step/step_processor.py
  from .models import StepInput, StepOutput

  class StepProcessor:
      def process(self, input_data: StepInput) -> StepOutput:
          # Implementation
          return StepOutput(result={...}, confidence=0.95)
  ```

- [ ] 4. **Add to facade_workflow.py**
  ```python
  # ncrs/facade_workflow.py
  from ncrs.new_step.step_processor import StepProcessor

  def execute_query_workflow(...):
      # ...existing steps...

      # Step X: New Step
      step_processor = StepProcessor()
      step_result = step_processor.process(StepInput(...))

      if event_emitter:
          event_emitter.emit_event(f"step_{X}_complete", step_result.dict())
  ```

- [ ] 5. **Update configuration**
  ```yaml
  # ncrs/config/new_step_params.yaml
  step_name: "New Step"
  timeout_ms: 1000
  max_retries: 3
  ```

### API Integration

- [ ] 6. **Add SSE event type**
  ```python
  # src/api/utils/event_emitter.py
  def emit_step_X_event(self, data: dict):
      self.emit_event(f"step_{X}_complete", data)
  ```

- [ ] 7. **Update NCRSAdapter**
  ```python
  # src/api/app/ncrs_adapter.py
  # Ensure new step events are emitted
  ```

### Frontend Visualization

- [ ] 8. **Create visualization component**
  ```bash
  touch src/web/src/components/visualizations/stages/NewStepDetail.tsx
  ```

- [ ] 9. **Implement component**
  ```typescript
  // src/web/src/components/visualizations/stages/NewStepDetail.tsx
  export function NewStepDetail({ data }: { data: StepData }) {
    return (
      <div className="step-detail">
        <h3>Step X: New Step</h3>
        {/* Visualization */}
      </div>
    );
  }
  ```

- [ ] 10. **Add to VisualizationTabs**
  ```typescript
  // src/web/src/components/visualizations/VisualizationTabs.tsx
  import { NewStepDetail } from './stages/NewStepDetail';

  case X: return <NewStepDetail data={steps[X]} />;
  ```

### Testing

- [ ] 11. **Create unit tests**
  ```bash
  touch tests/ncrs/new_step/test_step_processor.py
  ```

- [ ] 12. **Write test cases**
  ```python
  # tests/ncrs/new_step/test_step_processor.py
  import pytest
  from ncrs.new_step.step_processor import StepProcessor

  def test_step_processor_basic():
      processor = StepProcessor()
      result = processor.process(StepInput(...))
      assert result.confidence > 0.5
  ```

- [ ] 13. **Run tests**
  ```bash
  pytest tests/ncrs/new_step/ -v
  ```

- [ ] 14. **Add integration test**
  ```bash
  touch tests/integration/test_workflow_with_new_step.py
  ```

---

## Frontend Visualization Development

### Component Development Workflow

- [ ] 1. **Define TypeScript types**
  ```typescript
  // src/web/src/types/visualization.ts
  export interface StepData {
    step: number;
    status: 'pending' | 'running' | 'complete';
    result: any;
  }
  ```

- [ ] 2. **Create component file**
  ```bash
  touch src/web/src/components/visualizations/NewComponent.tsx
  ```

- [ ] 3. **Implement component**
  ```typescript
  export function NewComponent({ data }: { data: StepData }) {
    const [selectedItem, setSelectedItem] = useState<string | null>(null);

    return (
      <div>
        {/* Render visualization */}
      </div>
    );
  }
  ```

- [ ] 4. **Add Zustand store integration**
  ```typescript
  import { useWorkflowStore } from '@/stores/workflowStore';

  const { currentStep, steps } = useWorkflowStore();
  ```

- [ ] 5. **Write component tests**
  ```bash
  touch src/web/src/components/visualizations/__tests__/NewComponent.test.tsx
  ```

- [ ] 6. **Test SSE integration**
  ```typescript
  import { useSSE } from '@/hooks/useSSE';

  const { events } = useSSE(queryId);
  ```

- [ ] 7. **Verify accessibility**
  - [ ] Keyboard navigation works
  - [ ] Screen reader announcements
  - [ ] ARIA labels present

---

## Testing Checklist

### Unit Tests

- [ ] 1. **Backend unit tests**
  ```bash
  pytest tests/ncrs/ -v --cov=ncrs --cov-report=term-missing
  ```

- [ ] 2. **Frontend unit tests**
  ```bash
  cd src/web
  npm test
  ```

- [ ] 3. **Verify coverage**
  - [ ] Target: 85%+ overall
  - [ ] Facade: 65%+
  - [ ] Workflow: 80%+
  - [ ] Core operations: 85%+

### Integration Tests

- [ ] 4. **End-to-end workflow test**
  ```bash
  pytest tests/integration/test_complete_workflow.py -v
  ```

- [ ] 5. **API integration test**
  ```bash
  pytest tests/api/test_query_endpoint.py -v
  ```

- [ ] 6. **SSE streaming test**
  ```bash
  pytest tests/api/test_event_streaming.py -v
  ```

### Performance Tests

- [ ] 7. **Latency benchmark**
  ```bash
  pytest tests/performance/test_query_latency.py -v
  ```

- [ ] 8. **Verify metrics**
  - [ ] Total latency: < 2,000ms (target: ~1,835ms)
  - [ ] Step 5 (SNN): < 1,500ms (current: ~1,234ms)
  - [ ] LLM calls: 7-8 total

- [ ] 9. **Memory usage test**
  ```bash
  pytest tests/performance/test_memory_usage.py -v
  ```

- [ ] 10. **Verify memory**
  - [ ] SNN baseline: ~2.1GB
  - [ ] SNN peak: < 3.0GB (current: ~2.8GB)

### Stress Tests

- [ ] 11. **Multi-query stress test**
  ```bash
  pytest tests/stress/test_concurrent_queries.py -v
  ```

- [ ] 12. **1000-query benchmark**
  ```bash
  python benchmarks/run_1000_queries.py
  ```

---

## Deployment Checklist

### Pre-Deployment

- [ ] 1. **Verify dependencies**
  - [ ] Python 3.9+ installed
  - [ ] Node.js 16+ installed (frontend)
  - [ ] Brian2 2.9.0 installed
  - [ ] All required packages in requirements.txt

- [ ] 2. **Download data files**
  - [ ] ConceptNet CSV (3.4M edges) in `data/`
  - [ ] ConceptNet embeddings (1.66GB NPZ) in `data/`
  - [ ] Verify file sizes and checksums

- [ ] 3. **Start Qwen RPC server**
  ```bash
  # On separate machine or GPU server
  python -m qwen_rpc_server --port 9090 --model Qwen2.5-7B-Instruct
  ```

- [ ] 4. **Verify RPC connectivity**
  ```bash
  curl http://localhost:9090/health
  ```

- [ ] 5. **Run tests**
  ```bash
  pytest tests/ -v --cov=ncrs
  ```

### Backend Deployment

- [ ] 6. **Configure environment**
  ```bash
  export QWEN_RPC_URL=localhost:9090
  export DATA_DIR=/path/to/data
  export LOG_LEVEL=INFO
  ```

- [ ] 7. **Start FastAPI server**
  ```bash
  uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --workers 4
  ```

- [ ] 8. **Verify health endpoint**
  ```bash
  curl http://localhost:8000/api/v1/health
  ```

### Frontend Deployment

- [ ] 9. **Build frontend**
  ```bash
  cd src/web
  npm install
  npm run build
  ```

- [ ] 10. **Configure API endpoint**
  ```typescript
  // src/web/.env.production
  VITE_API_URL=http://your-api-server:8000
  ```

- [ ] 11. **Deploy static assets**
  ```bash
  # Copy dist/ to web server
  cp -r dist/ /var/www/ncrs/
  ```

### Post-Deployment

- [ ] 12. **Smoke test**
  - [ ] Submit test query via UI
  - [ ] Verify SSE events stream correctly
  - [ ] Check final answer is generated

- [ ] 13. **Monitor logs**
  ```bash
  tail -f logs/ncrs.log
  ```

- [ ] 14. **Check metrics**
  - [ ] Average query time < 2,000ms
  - [ ] Success rate > 95%
  - [ ] LLM call count: 7-8 per query

---

## Debugging Workflow Issues

### Step 1: Classification Issues

- [ ] 1. **Verify LLM connection**
  ```python
  from ncrs.rpc.qwen_client import QwenClient
  client = QwenClient()
  response = client.health_check()
  ```

- [ ] 2. **Check classification output**
  ```python
  from ncrs.classification.llm_query_classifier import classify_query
  result = classify_query("Test query")
  print(result.query_type, result.confidence)
  ```

- [ ] 3. **Verify weight profiles**
  ```python
  from ncrs.classification.profile_manager import load_profiles
  profiles = load_profiles()
  ```

### Step 2: HyDe Issues

- [ ] 4. **Test HyDe generation**
  ```python
  from ncrs.goal_region.hyde_ensemble import generate_goal_region
  result = generate_goal_region("Test query")
  print(result.hypotheses)
  ```

- [ ] 5. **Check fallback chain**
  ```python
  # If HyDe fails, verify fallback to seed centroid
  # Then to query embedding, then to zero vector
  ```

- [ ] 6. **Verify embedding cache**
  ```bash
  ls -lh data/conceptnet_embeddings.npz  # Should be 1.66GB
  ```

### Step 3: Seed Extraction Issues

- [ ] 7. **Test fuzzy search**
  ```python
  from ncrs.seed_extraction.csv_fuzzy_search import search_concepts
  results = search_concepts("accident")
  ```

- [ ] 8. **Check goldilocks filter**
  ```python
  # Verify threshold ≥ 0.4
  from ncrs.seed_extraction.goldilocks_filter import filter_candidates
  ```

### Step 5: SNN Simulation Issues

- [ ] 9. **Verify Brian2 installation**
  ```python
  import brian2
  print(brian2.__version__)  # Should be 2.9.0
  ```

- [ ] 10. **Check network creation**
  ```python
  from ncrs.orchestrator.core import create_network
  network = create_network()
  print(network.num_neurons)  # ~2.3M neurons
  ```

- [ ] 11. **Monitor SNN execution**
  ```python
  # Add logging to hop_runner/simulation_execution.py
  logger.info(f"Hop {hop_num}: {len(winners)} winners")
  ```

### Step 8: Synthesis Issues

- [ ] 12. **Test synthesis directly**
  ```python
  from ncrs.synthesis.answer_synthesizer import synthesize_answer
  result = synthesize_answer(paths, query)
  print(result.answer, result.confidence)
  ```

- [ ] 13. **Check prompt builder**
  ```python
  from ncrs.synthesis.prompt_builder import build_synthesis_prompt
  prompt = build_synthesis_prompt(paths, query)
  print(prompt)
  ```

### General Debugging

- [ ] 14. **Enable debug logging**
  ```python
  import logging
  logging.basicConfig(level=logging.DEBUG)
  ```

- [ ] 15. **Check JSONL recordings**
  ```bash
  tail -f path_recordings/paths_output.jsonl
  ```

- [ ] 16. **Monitor performance**
  ```python
  from ncrs.monitoring.performance_tracker import PerformanceTracker
  tracker = PerformanceTracker()
  tracker.print_report()
  ```

---

## Configuration Updates

### Updating YAML Configs

- [ ] 1. **Identify config file**
  ```
  config/                    # Top-level (3 files)
  ncrs/config/              # NCRS core (10 files)
  ncrs/classification/      # Classification (3 files)
  ```

- [ ] 2. **Edit YAML file**
  ```yaml
  # Example: ncrs/config/network_params.yaml
  k_wta: 500              # Change to 1000
  lateral_inhibition: true
  ```

- [ ] 3. **Validate YAML syntax**
  ```bash
  python -c "import yaml; yaml.safe_load(open('config/file.yaml'))"
  ```

- [ ] 4. **Restart services**
  ```bash
  # Restart FastAPI to pick up changes
  pkill -f uvicorn
  uvicorn src.api.main:app --reload
  ```

### Updating Python Configs

- [ ] 5. **Edit Python config**
  ```python
  # ncrs/config.py
  def get_performance_targets():
      return {
          "target_convergence_rate": 0.60  # Increase from 0.50
      }
  ```

- [ ] 6. **Verify changes**
  ```python
  from ncrs.config import get_performance_targets
  print(get_performance_targets())
  ```

---

## Performance Optimization

### Profiling

- [ ] 1. **Run profiler**
  ```bash
  python -m cProfile -o profile.stats scripts/run_query.py
  ```

- [ ] 2. **Analyze results**
  ```python
  import pstats
  stats = pstats.Stats('profile.stats')
  stats.sort_stats('cumulative').print_stats(20)
  ```

- [ ] 3. **Identify bottlenecks**
  - [ ] Check if Step 5 (SNN) > 70% of total time
  - [ ] Check if HyDe > 15% of total time

### SNN Optimization

- [ ] 4. **Increase parallel workers**
  ```python
  result = system.run_query(query, max_workers=16)  # Up from 8
  ```

- [ ] 5. **Optimize k-WTA selection**
  ```python
  # ncrs/config/network_params.yaml
  k_wta: 300  # Reduce from 500 for faster selection
  ```

- [ ] 6. **Enable sparse mode**
  ```python
  # Verify sparse neuron creation in unified_cortex.py
  ```

### LLM Optimization

- [ ] 7. **Switch to async HyDe**
  ```python
  # In facade_workflow.py
  from ncrs.goal_region.hyde_ensemble_async import generate_goal_region_async
  ```

- [ ] 8. **Cache query classifications**
  ```python
  # Add LRU cache to llm_query_classifier.py
  from functools import lru_cache

  @lru_cache(maxsize=1000)
  def classify_query(query: str):
      ...
  ```

- [ ] 9. **Batch LLM calls**
  ```python
  # Batch seed extraction LLM calls
  ```

### Memory Optimization

- [ ] 10. **Enable embedding lazy loading**
  ```python
  # In embeddings/cache.py
  lazy_load = True
  ```

- [ ] 11. **Reduce SNN snapshot frequency**
  ```python
  # In hop_runner/simulation_execution.py
  snapshot_interval = 10  # Up from 5
  ```

- [ ] 12. **Clear path recordings**
  ```bash
  rm -rf path_recordings/temp_queries/*
  ```

### Monitoring

- [ ] 13. **Track metrics**
  ```python
  from ncrs.monitoring.performance_tracker import track_query

  with track_query() as tracker:
      result = system.run_query(query)

  print(tracker.get_breakdown())
  ```

- [ ] 14. **Set up alerts**
  - [ ] Alert if query time > 3,000ms
  - [ ] Alert if failure rate > 10%
  - [ ] Alert if memory > 4GB

---

**Last Updated**: 2025-11-10
**Checklist Version**: 2.0
**Status**: ✅ Complete, covers all major workflows
