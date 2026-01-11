# NCRS Codebase Structure

**Last Updated**: 2025-11-10
**Total Files**: 2,057 files
**Primary Language**: Python + TypeScript

---

## Directory Overview

```
/home/cabdru/newdemo/
├── ncrs/                      # Core backend logic (262 Python files)
├── src/                       # API & frontend (~130 files)
│   ├── api/                  # FastAPI backend (~50 Python files)
│   └── web/                  # React frontend (~80 TypeScript files)
├── tests/                     # Test suite (144 test files)
├── config/                    # Top-level configuration (3 YAML)
├── data/                      # ConceptNet data (1.66GB embeddings)
├── docs/                      # Documentation
├── path_recordings/           # JSONL path outputs
└── [Other]                    # ~1,521 files (generated, migrations, utilities)
```

---

## Core Backend (`/ncrs/` - 262 files)

### Facade Layer (Entry Point)
```
ncrs/
├── facade.py                  # 131 lines - PRIMARY ENTRY POINT
├── facade_core.py             # 226 lines - Initialization & state
├── facade_workflow.py         # 554 lines - 8-step orchestration
├── facade_metrics.py          # 103 lines - Metrics computation
└── facade_validation.py       # 138 lines - Input validation
```

### Workflow Components (8 Steps)

#### Step 1: Query Classification
```
ncrs/classification/
├── llm_query_classifier.py    # 991 lines - Main classifier
├── models.py                  # QueryType enum
├── profile_manager.py         # Weight profile loading
├── classifier_schemas.py      # Pydantic schemas
├── health_*.py               # Health monitoring
├── config/
│   ├── llm_classifier_config.yaml
│   ├── profiles.yaml         # 9 query type profiles
│   └── prompts/temperature_config.yaml
└── [8 other support files]
```

#### Step 2: HyDe Goal Generation
```
ncrs/goal_region/
├── hyde_ensemble.py           # 694 lines - MANDATORY (sync version)
├── hyde_ensemble_async.py     # 697 lines - Optional async version
├── goal_region_models.py      # Data models
├── hyde_models.py             # Schema validation
├── integration.py             # Integration utilities
└── [5 other files]
```

#### Step 3: Seed Extraction
```
ncrs/seed_extraction/          # 18 modules
├── extraction_orchestrator.py # Main orchestrator
├── llm_concept_extractor.py   # LLM-based extraction
├── csv_fuzzy_search.py        # RapidFuzz search
├── dual_search_engine.py      # CSV + embedding search
├── goldilocks_filter.py       # Quality filter (≥0.4 threshold)
├── candidate_generator.py     # Candidate generation
└── [12 other modules]

ncrs/seed_selection/           # Enhanced seed selection
├── seed_selector.py           # 🗑️ DEPRECATED (use extraction_orchestrator)
└── [Other legacy files]
```

#### Steps 4-7: Multi-Path Exploration
```
ncrs/multi_path_controller/    # 872 lines total
├── controller.py              # Main controller
├── stage_seed_initialization.py     # Step 4: Initialize paths
├── stage_multihop_loop.py          # Step 5: Multi-hop loop
├── stage_path_persistence.py       # Step 7: JSONL recording
├── stage_synthesis.py              # Coordination with Step 8
├── stage_ranking.py                # Path ranking
├── parallel_worker_pool.py         # 8 parallel workers
├── hop_termination_checker.py      # Step 6: Regression detection
├── goal_distance_calculator.py     # Goal gradient
├── path_persistence.py             # JSONL writer
└── path_ranking.py                 # Ranking logic

ncrs/exploration/              # 761 lines
├── [Legacy exploration modules]

ncrs/hop_runner/               # SNN simulation core
├── simulation_execution.py    # Brian2 simulation
├── kwta_management.py         # k-WTA winner selection
├── goal_gradient_ops.py       # Goal distance computation
├── weight_modulation.py       # Dynamic weights
└── spike_processing.py        # TTFS extraction

ncrs/hybrid/                   # Path state management
├── dynamic_path_manager.py    # 597 lines - Main path manager
└── path_history/
    ├── core.py               # Path history core
    ├── analytics.py          # Path analytics
    ├── branching.py          # Branching logic
    └── diversity.py          # MMR diversity

ncrs/orchestrator/             # Brian2 network creation
├── core.py                   # Orchestrator core
├── network_creation.py       # Network builder
├── network_validation.py     # Validation
└── synapse_validation.py     # Synapse checks
```

#### Step 8: Answer Synthesis
```
ncrs/synthesis/                # 698 lines total
├── answer_synthesizer.py      # Main synthesizer
├── prompt_builder.py          # Prompt construction
├── evidence_formatter.py      # Evidence formatting
├── confidence_weighting.py    # Confidence scores
└── clustering.py              # 🗑️ DEPRECATED (single-cluster now)
```

### Infrastructure Layer

#### Embeddings
```
ncrs/embeddings/
├── cache.py                   # 683 lines - Embedding cache
├── lru_cache.py              # LRU cache implementation
└── semantic_similarity.py     # Cosine distance
```

#### LLM Integration
```
ncrs/llm/
├── client.py                  # Sync LLM client
├── async_client.py            # Async LLM client (partial)
└── circuit_breaker.py         # Resilience pattern

ncrs/rpc/                      # 750 lines total
├── qwen_client.py             # Qwen RPC client
├── async_qwen_client.py       # Async Qwen client
├── health_monitor.py          # Health checks
└── retry_metrics.py           # Retry tracking
```

#### Monitoring
```
ncrs/monitoring/
└── performance_tracker.py     # Performance tracking
```

#### State Management
```
ncrs/state/                    # 771 lines
├── state_manager.py
├── query_state.py
└── [Other state modules]
```

#### Utilities
```
ncrs/utils/                    # 836 lines
├── concept_uri.py
├── text_processing.py
├── cache_utils.py
└── [Other utilities]
```

### SNN Architecture
```
ncrs/
├── unified_cortex.py          # 9-column cortex (2.3M neurons)
├── neuron_factory.py          # LIF neuron creation
├── synapse_builder.py         # Synapse construction
├── termination.py             # Termination logic
├── termination_config.py      # Termination config
└── csv_data_cache.py          # ConceptNet CSV cache
```

### Advanced Features
```
ncrs/learning/                 # Adaptive learning
├── adaptive_coach.py          # Adaptive learning
├── parameter_predictor.py     # Meta-learning
├── lambda_manager.py          # Lambda modulation
└── experience_buffer.py       # Replay buffer

ncrs/analysis/                 # Analysis tools
├── mmr_selector.py            # Diversity selection
└── convergence_analyzer.py    # Convergence analysis
```

### Configuration
```
ncrs/config/                   # 10 YAML files
├── stdp_params.yaml
├── lambda_profiles.yaml
├── gain_profiles.yaml
├── column_weights.yaml
├── goal_params.yaml
├── network_params.yaml
├── agents.yaml
├── causal_params.yaml
├── compositional_params.yaml
├── integration_params.yaml
└── planning_params.yaml

ncrs/config/                   # Python config loaders
├── goal_config.py
└── stdp_config.py
```

### Deprecated Modules (To Remove)
```
ncrs/
├── runtime_mode_controller.py # 🗑️ Use NCRS facade instead
├── controller.py              # 🗑️ Use NCRS facade instead
└── seed_selection/seed_selector.py  # 🗑️ Use extraction_orchestrator
```

---

## API Layer (`/src/api/` - ~50 files)

### FastAPI Application
```
src/api/
├── main.py                    # 4,731 bytes - FastAPI app entry
├── routes/
│   ├── query.py              # POST /api/v1/query
│   └── events.py             # 228 lines - GET /api/v1/events (SSE)
├── app/
│   ├── ncrs_adapter.py       # Async/sync bridge
│   └── event_bus.py          # 335 lines - Event bus
├── utils/
│   └── event_emitter.py      # 464 lines - Event emission
├── models/                    # Pydantic models
├── middleware/                # CORS, auth, etc.
└── config/                    # API configuration
```

---

## Frontend (`/src/web/` - ~80 TypeScript files)

### Visualization Components
```
src/web/src/components/visualizations/
├── stages/                    # 8 step visualizations (65KB total)
│   ├── ClassificationDetail.tsx        # 6,795 bytes
│   ├── HyDeGoalDetail.tsx             # 6,814 bytes
│   ├── SeedExtractionDetail.tsx       # 8,313 bytes
│   ├── MultiHopInitDetail.tsx         # 6,880 bytes
│   ├── MultiHopProgressDetail.tsx     # 12,563 bytes
│   ├── PathRankingDetail.tsx          # 10,010 bytes
│   ├── PathPersistenceDetail.tsx      # 6,685 bytes
│   └── PathTerminationDetail.tsx      # 7,266 bytes
├── MultiHopPathView.tsx
├── PathDetailPanel.tsx
├── PathReplayTimeline.tsx
├── PathTreeVisualization.tsx
├── TerminatedPathsList.tsx
├── VisualizationFilters.tsx
└── VisualizationTabs.tsx

src/web/src/components/debug/
├── FilterPanel.tsx
└── ReplayTimeline.tsx

src/web/src/components/workflow/
├── WorkflowProgressTracker.tsx
└── WorkflowStageDetail.tsx
```

### State Management (Zustand)
```
src/web/src/stores/
├── workflowStore.ts           # Main workflow state
├── visualizationStore.ts      # Visualization state
├── hopStore.ts               # Hop-by-hop state
└── queryStore.ts             # Query state
```

### Hooks
```
src/web/src/hooks/
├── useSSE.ts                 # SSE event handling
├── useSSEWithRetry.ts        # SSE with retry
├── useWorkflowStreamEnhanced.ts  # Enhanced streaming
├── useSchemas.ts             # Schema management
├── useAnnouncer.tsx          # Accessibility
├── useKeyboardNavigation.ts
└── usePathAnimation.ts
```

### Pages
```
src/web/src/pages/
├── NCRSQueryPage.tsx         # Main query page
├── QueryPage.tsx
├── QueryPageWithSchema.tsx
└── SchemaExplorerPage.tsx
```

### Types
```
src/web/src/types/
├── api.ts                    # API types
└── visualization.ts          # Visualization types
```

### Utilities
```
src/web/src/utils/
├── eventArchive.ts
├── goal-gradient.ts
├── graphLayout.ts
├── jsonlReader.ts
└── sseEventParser.ts
```

---

## Test Suite (`/tests/` - 144 files)

### Backend Tests
```
tests/
├── ncrs/
│   ├── classification/       # ~10 tests
│   ├── goal_region/          # ~15 tests
│   ├── seed_extraction/      # ~20 tests
│   ├── multi_path_controller/ # ~30 tests
│   ├── synthesis/            # ~10 tests
│   ├── integration/          # ~15 tests
│   └── utils/                # ~25 tests
└── api/                      # API tests
```

### Frontend Tests (TypeScript)
```
src/web/src/components/visualizations/__tests__/
├── BranchPointIndicator.test.tsx
├── JSONLRecordingViewer.test.tsx
├── TerminatedPathsList.test.tsx
├── TerminationBadge.test.tsx
├── VisualizationTabs.test.tsx
└── WorkflowProgressTracker.test.tsx

src/web/src/stores/__tests__/
├── queryStore.test.ts
└── [Other store tests]

src/web/src/utils/__tests__/
├── jsonlReader.test.ts
└── sseEventParser.test.ts
```

### Test Utilities
```
src/web/src/tests/
├── mockStores.ts
└── test-utils.tsx
```

---

## Configuration (`/config/` - 3 files)

```
config/
├── weighting_strategy.yaml    # TF-IDF relationship weights
├── goal_convergence_config.yaml  # Convergence settings
└── qwen_config.yaml           # Qwen RPC configuration
```

---

## Data Directory (`/data/`)

```
data/
├── edges_*.csv               # ConceptNet edges (3.4M rows)
├── conceptnet_embeddings.npz # 1.66GB embedding vectors (384D)
├── concept_index.pkl         # Fast lookup index (assumed)
└── cache/                    # Runtime cache files
```

---

## Path Recordings (`/path_recordings/`)

```
path_recordings/
├── paths_output.jsonl        # Main output (one path per line)
├── query_*.jsonl            # Per-query recordings
└── temp_queries/            # 76 temp directories (⚠️ cleanup needed)
```

---

## Documentation (`/docs/`)

```
docs/
├── WORKFLOW.md               # 1,162 lines - System workflow spec
├── WORKFLOW_GAP_ANALYSIS.md  # 857 lines - Gap analysis
├── 01_system_mapping/        # Phase 0 analysis (5 files)
│   ├── 00_executive_summary.md
│   ├── 01_directory_structure.md
│   ├── 02_workflow_implementation_status.md
│   ├── 03_dependency_graph.md
│   └── README.md
├── agent9-pass2-null-safety-fixes.md
└── [Other documentation]
```

---

## Other Directories

### Examples
```
src/web/src/examples/
└── WorkflowProgressExample.tsx
```

### Generated/Build Artifacts (Excluded from Version Control)
```
node_modules/                 # Frontend dependencies
__pycache__/                  # Python bytecode
.pytest_cache/                # Pytest cache
dist/                         # Build output
build/                        # Build artifacts
```

---

## File Statistics

### By File Type
| Type | Count | Purpose |
|------|-------|---------|
| Python (`.py`) | ~407 | Backend logic + tests |
| TypeScript (`.tsx`, `.ts`) | ~80 | Frontend UI + logic |
| YAML (`.yaml`, `.yml`) | 13-17 | Configuration |
| Markdown (`.md`) | ~10 | Documentation |
| JSON (`.json`) | ~5 | Package configs |
| JSONL (`.jsonl`) | Variable | Path recordings |

### By Layer
| Layer | Files | Lines (est.) |
|-------|-------|--------------|
| Core NCRS | 262 | ~50,000 |
| API | ~50 | ~8,000 |
| Frontend | ~80 | ~25,000 |
| Tests | 144 | ~20,000 |
| Config | 13-17 | ~2,000 |
| **Total** | **~550** | **~105,000** |

---

## Module Dependencies

### No Circular Dependencies ✅
All 5 layers have clean, top-down dependencies:
```
Layer 5: API (FastAPI, NCRSAdapter, EventBus)
    ↓
Layer 4: Orchestration (facade_workflow.py, facade_core.py)
    ↓
Layer 3: Workflow Steps (8 steps, 262 files)
    ↓
Layer 2: Core Services (LLMClient, StateManager, PerformanceTracker)
    ↓
Layer 1: Foundation (EmbeddingCache, RPCClient, Utils)
```

### Key Entry Points
1. **Python API**: `ncrs/facade.py` → `facade_workflow.execute_query_workflow()`
2. **REST API**: `src/api/main.py` → `POST /api/v1/query`
3. **Frontend**: `src/web/src/pages/NCRSQueryPage.tsx`

---

## Code Organization Principles

### ✅ Good Practices Observed
1. **Modular Design**: Clear separation of concerns (facade → workflow → operations)
2. **Single Responsibility**: Each module has one clear purpose
3. **Type Safety**: Pydantic schemas throughout backend, TypeScript in frontend
4. **Test Coverage**: 144 test files (~67% coverage)
5. **Configuration**: Externalized to YAML files
6. **Documentation**: Comprehensive inline docs + separate documentation

### ⚠️ Areas for Improvement
1. **Deprecated Code**: 4 legacy modules should be removed
2. **Temporary Files**: 76 temp_queries directories need cleanup
3. **Unused Dependencies**: 4 dependencies should be removed from requirements.txt
4. **Test Coverage**: Increase from 67% to 85%+ target

---

## Size & Complexity Metrics

### Large Files (>500 lines)
- `facade_workflow.py`: 554 lines (orchestration complexity)
- `llm_query_classifier.py`: 991 lines (classification logic)
- `multi_path_controller/controller.py`: 872 lines (modular v2.0)
- `embeddings/cache.py`: 683 lines (caching logic)
- `hyde_ensemble_async.py`: 697 lines (async implementation)
- `state/state_manager.py`: 771 lines (state management)

### Complexity Assessment
- **Facade Layer**: Medium complexity (orchestration)
- **Workflow Steps**: High complexity (8 distinct stages)
- **Core Operations**: High complexity (SNN simulation, path management)
- **Infrastructure**: Medium complexity (caching, RPC, monitoring)
- **Frontend**: Medium complexity (8 visualization components)

---

**Last Verified**: 2025-11-10
**Structure Status**: ✅ Well-organized, modular, ready for production
**Cleanup Needed**: Deprecated modules + temp directories
