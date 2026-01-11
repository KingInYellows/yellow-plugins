# NCRS Technology Stack

**Last Updated**: 2025-11-10
**System Version**: 2.0.0

---

## Core Technologies

### Spiking Neural Network (SNN)
- **Framework**: Brian2 2.9.0
- **Mode**: CPU-only (no CUDA support)
- **Neuron Model**: Leaky Integrate-and-Fire (LIF)
- **Tau**: 20ms
- **Architecture**: 9 cortical columns, ~2.41M sparse neurons
- **Selection**: k-WTA lateral inhibition (k=500)
- **Memory**: ~2.1GB RAM baseline, ~2.8GB peak

### Large Language Model (LLM)
- **Model**: Qwen2.5-7B-Instruct
- **Deployment**: XML-RPC server
- **Endpoint**: localhost:9090
- **Precision**: BF16 (3.6GB VRAM)
- **Constrained Generation**: Outlines (>95% success rate)
- **Calls per Query**: 7-8 total
  - 1 classification
  - 5 HyDe ensemble
  - 1-2 seed extraction
  - 1 synthesis

### Knowledge Graph
- **Source**: ConceptNet 5.5
- **Concepts**: 1.8M concepts
- **Relationships**: 3.4M edges
- **Format**: CSV (9 columns)
- **Categories**: 9 relationship types
- **Embeddings**: 384-dimensional vectors (1.66GB NPZ file)
- **Search**: RapidFuzz fuzzy matching (10-100x speedup)

---

## External Dependencies

### Critical (Required for Operation)

```python
# SNN Simulation
brian2==2.9.0              # Spiking neural network simulator

# Data Processing
numpy==1.26.4              # Numerical computing
pandas==2.0.0              # CSV data manipulation
scipy==1.16.3              # Scientific computing

# Search & Matching
rapidfuzz>=3.0.0           # Fast fuzzy string matching

# LLM Integration
outlines                   # Constrained LLM generation
nltk>=3.8.0               # Natural language processing

# API & Web
fastapi>=0.100.0          # REST API framework
sse-starlette>=1.6.0      # Server-Sent Events streaming
aiohttp>=3.9.0            # Async HTTP client

# Configuration & Data
pydantic>=2.0.0,<3.0.0    # Schema validation
pyyaml>=6.0               # Config parsing
jsonlines>=3.1.0          # Path recording

# Utilities
scikit-learn>=1.3.0       # Machine learning utilities
```

### Deprecated (Should Remove)

```python
# ❌ UNUSED - Remove from requirements.txt
sentence-transformers>=2.2.0  # Replaced by LLM-based embeddings
torch>=2.5.0                  # Backend for sentence-transformers (unused)
transformers>=4.50.0          # LLM via RPC instead
spacy>=3.5.0                  # Deprecated NER functionality
```

**Action Required**: Remove these 4 dependencies to reduce install size and time.

---

## Frontend Technologies

### React Stack
- **Framework**: React 18+ with TypeScript
- **State Management**: Zustand
- **UI Components**: Custom visualization components
- **Event Streaming**: Server-Sent Events (SSE)
- **Build Tool**: Vite (assumed)

### Visualization Components (8 Total)
1. **ClassificationDetail** (6,795 bytes) - Step 1 visualization
2. **HyDeGoalDetail** (6,814 bytes) - Step 2 visualization
3. **SeedExtractionDetail** (8,313 bytes) - Step 3 visualization
4. **MultiHopInitDetail** (6,880 bytes) - Step 4 visualization
5. **MultiHopProgressDetail** (12,563 bytes) - Step 5 visualization
6. **PathRankingDetail** (10,010 bytes) - Step 6 visualization
7. **PathPersistenceDetail** (6,685 bytes) - Step 7 visualization
8. **PathTerminationDetail** (7,266 bytes) - Step 8 visualization

**Total**: 65,326 bytes of visualization code

### Frontend File Structure
```
src/web/
├── src/components/
│   ├── visualizations/stages/  # 8 step visualizations
│   ├── debug/                  # Debugging components
│   └── workflow/               # Workflow tracking
├── src/hooks/
│   ├── useSSE.ts              # SSE event handling
│   ├── useWorkflowStreamEnhanced.ts
│   └── useSchemas.ts
├── src/stores/
│   ├── workflowStore.ts       # Zustand state
│   ├── visualizationStore.ts
│   └── hopStore.ts
└── src/pages/
    ├── NCRSQueryPage.tsx
    ├── QueryPage.tsx
    └── SchemaExplorerPage.tsx
```

---

## API Layer

### FastAPI Backend
- **Framework**: FastAPI
- **Server**: Uvicorn
- **Streaming**: SSE-Starlette
- **Async/Sync Bridge**: NCRSAdapter
- **Event Bus**: Real-time event distribution
- **Main Entry**: `src/api/main.py` (4,731 bytes)

### API Components
```python
# Core API Files
src/api/
├── main.py                    # FastAPI app (4,731 bytes)
├── routes/
│   ├── query.py              # Query endpoint
│   └── events.py             # SSE streaming (228 lines)
├── app/
│   ├── ncrs_adapter.py       # Async/sync bridge
│   └── event_bus.py          # Event bus (335 lines)
└── utils/
    └── event_emitter.py       # Event emission (464 lines)
```

### API Endpoints
```
POST /api/v1/query            # Submit query
GET  /api/v1/events           # SSE event stream
GET  /api/v1/health           # Health check (assumed)
```

---

## Configuration System

### YAML Configuration Files

**Total**: 13-17 YAML files across 3 directories

#### Root Configuration (`/config/` - 3 files)
1. `weighting_strategy.yaml` - TF-IDF relationship type multipliers
2. `goal_convergence_config.yaml` - Goal convergence settings (epsilon, max_hops)
3. `qwen_config.yaml` - Qwen LLM RPC configuration

#### NCRS Core Configuration (`/ncrs/config/` - 10 files)
1. `stdp_params.yaml` - STDP learning parameters
2. `lambda_profiles.yaml` - Lambda weights for UTL
3. `gain_profiles.yaml` - Query context gains
4. `column_weights.yaml` - Column-specific base weights (9 columns)
5. `goal_params.yaml` - Goal gradient parameters
6. `network_params.yaml` - Lateral inhibition settings (k=500)
7. `agents.yaml` - Agent configuration
8. `causal_params.yaml` - Causal query weights
9. `compositional_params.yaml` - Compositional weights
10. `integration_params.yaml` - Integration parameters
11. `planning_params.yaml` - Planning parameters

#### Classification Configuration (`/ncrs/classification/` - 3 files)
1. `llm_classifier_config.yaml` - Classifier configuration
2. `profiles.yaml` - Query type weight profiles (9 types)
3. `prompts/temperature_config.yaml` - Temperature settings

### Python Configuration
```python
# Main config loaders
ncrs/config.py                 # AgentConfig, termination config
ncrs/config/goal_config.py     # Goal region configuration
ncrs/config/stdp_config.py     # STDP learning configuration
ncrs/termination_config.py     # Termination parameters
```

---

## Data Files & Storage

### ConceptNet Data
```
data/
├── edges_*.csv               # ConceptNet edges (3.4M rows, 9 columns)
├── conceptnet_embeddings.npz # 1.66GB embedding cache (384D)
└── concept_index.pkl         # Fast concept lookup (assumed)
```

### Path Recordings
```
path_recordings/
├── paths_output.jsonl        # One path per line
├── query_*.jsonl            # Per-query recordings
└── temp_queries/            # 76 temporary directories (cleanup needed)
```

### Cache Files
```
cache/
├── embedding_cache/         # LRU embedding cache
├── query_cache/            # Query classification cache
└── seed_cache/             # Seed decomposition cache
```

---

## Development Tools

### Testing
- **Framework**: pytest
- **Total Tests**: 144 files
- **Coverage**: ~67% overall
- **Frontend Tests**: 19 TypeScript test files (.test.tsx)

### Code Quality
- **Type Checking**: mypy (assumed)
- **Linting**: pylint/flake8 (assumed)
- **Formatting**: black/prettier (assumed)
- **Schema Validation**: Pydantic v2

---

## Infrastructure Requirements

### Compute Resources
| Resource | Minimum | Recommended |
|----------|---------|-------------|
| **CPU** | 2 cores | 4+ cores |
| **RAM** | 4GB | 8GB |
| **Disk** | 2GB | 5GB+ |
| **GPU** | Not required | Optional (Qwen RPC server) |

### Network Services
- **Qwen RPC**: localhost:9090 (required)
- **FastAPI**: localhost:8000 (default)
- **Frontend**: localhost:3000 (default, dev mode)

### External Data Dependencies
1. ConceptNet CSV files (~500MB)
2. ConceptNet embeddings NPZ (1.66GB)
3. NLTK data (punkt, wordnet)

---

## Performance Characteristics

### Resource Usage During Query
```
CPU:  40-80% (8 parallel workers)
RAM:  2.1-2.8GB (SNN baseline + peak)
VRAM: 3.6GB (Qwen RPC server)
Disk: I/O for CSV lookup + JSONL recording
```

### Latency Breakdown
| Component | Time | % Total |
|-----------|------|---------|
| LLM calls (7-8) | 594ms | 32.3% |
| SNN simulation | 1,234ms | 66.8% |
| Other processing | 7ms | 0.9% |
| **Total** | **1,835ms** | **100%** |

### Scalability
- **Parallel Workers**: 8 (default), configurable up to 16
- **Concurrent Queries**: Limited by LLM RPC capacity
- **Path Exploration**: Unlimited independent paths per query

---

## Deprecated Technologies (To Remove)

### 🗑️ No Longer Used
1. **sentence-transformers** - Replaced by LLM-based embeddings
2. **torch/pytorch** - Backend for sentence-transformers (unused)
3. **transformers** - LLM via RPC instead of direct usage
4. **spacy** - Deprecated NER functionality

### 🗑️ Legacy Code
1. `ncrs/seed_selection/seed_selector.py` - Replaced by extraction_orchestrator
2. `ncrs/synthesis/clustering.py` - Removed in favor of single-cluster
3. `ncrs/runtime_mode_controller.py` - Use NCRS facade instead
4. `ncrs/controller.py` - Use NCRS facade instead

**Action**: Remove deprecated imports and clean up legacy modules.

---

## Version Compatibility

### Python Version
- **Required**: Python 3.9+
- **Tested**: Python 3.10, 3.11
- **Not Supported**: Python 3.8 (Pydantic v2 requirement)

### Key Dependency Versions
```python
python>=3.9
brian2==2.9.0          # Pin exact version (SNN compatibility)
numpy==1.26.4          # Pin exact version (Brian2 compatibility)
pandas==2.0.0          # Pin exact version (stability)
pydantic>=2.0.0,<3.0.0 # Pin major version (breaking changes in v3)
```

---

## Security Considerations

### Data Privacy
- No external API calls (LLM runs locally via RPC)
- All data stays on-premises
- ConceptNet is public domain data

### Network Security
- RPC server on localhost only (not exposed)
- FastAPI CORS configuration needed for frontend
- SSE connections authenticated (assumed)

### Dependency Security
- Regular updates needed for security patches
- No known vulnerabilities in core dependencies (as of 2025-11-10)

---

**Last Verified**: 2025-11-10
**Tech Stack Status**: ✅ Complete, stable, production-ready
**Deprecated Items**: 4 dependencies + 4 legacy modules identified for removal
