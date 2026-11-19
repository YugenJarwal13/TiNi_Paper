# TiNi Research Platform & Inflect Engine
## Comprehensive Architectural, Mathematical, and Functional Technical Report

---

## Table of Contents
1. [Executive Summary & Scientific Domain](#1-executive-summary--scientific-domain)
   - 1.1 The Research Problem & Paper Background
   - 1.2 System Scope & The Four Pillars
2. [End-to-End System Architecture](#2-end-to-end-system-architecture)
   - 2.1 Full-Stack Component Blueprint
   - 2.2 Directory Hierarchy & Responsibilities
   - 2.3 Resumability, Fingerprinted Checkpoints & Atomic I/O
3. [Pillar 1: Data Pipeline & Basic Physics Model (Version 1)](#3-pillar-1-data-pipeline--basic-physics-model-version-1)
   - 3.1 The Six Resumable Pipeline Stages
   - 3.2 Physical Formulations & Equations
   - 3.3 Prototype Peak Picker vs. Physical Quantities
4. [Pillar 2: The Inverse Problem — Inferring the Landscape (Version 2)](#4-pillar-2-the-inverse-problem--inferring-the-landscape-version-2)
   - 4.1 Theoretical Foundation: Kramers Rate & Critical-Force Distribution
   - 4.2 Numerical Inference Engine: Multi-Start Nelder-Mead & L-BFGS-B Polish
   - 4.3 Profile Likelihoods, Bootstrap & Synthetic Recovery
5. [Pillar 3: The Forward Smoluchowski Model (Version 3)](#5-pillar-3-the-forward-smoluchowski-model-version-3)
   - 5.1 The Time-Dependent Overdamped Fokker-Planck (Smoluchowski) PDE
   - 5.2 Elimination of Free Parameters (Deriving $\eta$ and $D$)
   - 5.3 Numerical Discretization: Scharfetter-Gummel Flux & Backward Euler
6. [Pillar 4: Inflect — Universal Tabular Curve Analysis (Version 4)](#6-pillar-4-inflect--universal-tabular-curve-analysis-version-4)
   - 6.1 The Generalization Paradigm
   - 6.2 Step 1: Ingestion & Dialect Sniffing (`ingest.py`)
   - 6.3 Step 2: Column Intelligence, Semantics & Ranking (`columns.py`)
   - 6.4 Step 3: Transition & Inflection Detection (`segment.py`)
     - *Why Onset, Not Peak?*
     - *The Locally Detrended Step Statistic*
     - *Geometric Cross Test (Knees vs. Steps)*
   - 6.5 Step 4: Optimal Regime Partitioning via Dynamic Programming
   - 6.6 Step 5: Narration & Stage Beat Generation (`transitions.py`)
   - 6.7 Step 6: Multi-Curve Chorus & Cohort Outlier Analysis (`chorus.py`, `ensemble.py`)
   - 6.8 Step 7: Uncertainty, 16-Setting Stability Sweep & Ledger Audit
7. [Frontend Architecture & Interactive Experience](#7-frontend-architecture--interactive-experience)
   - 7.1 Tech Stack & Design System
   - 7.2 Component Tree & View Routing
   - 7.3 The Stage Canvas & Annotation Engine
8. [End-to-End User Journey Walkthrough](#8-end-to-end-user-journey-walkthrough)
   - 8.1 File Upload & Interactive Analysis Flow
   - 8.2 Parameter Sweeps & Re-verification Flow
9. [Validation, Test Suite & How to Run](#9-validation-test-suite--how-to-run)
   - 9.1 Test Battery (210 Passing Tests)
   - 9.2 Execution Instructions

---

## 1. Executive Summary & Scientific Domain

### 1.1 The Research Problem & Paper Background
This software platform is built around the research paper:
> **A. Maitra & M. P. Gururajan**, *"Extracting rates and activation free energies of martensitic transitions using nanomechanical force statistics"*, *Scientific Reports* **15**:3008 (2025), [doi:10.1038/s41598-025-87324-w](https://doi.org/10.1038/s41598-025-87324-w) (archived in `docs/Maitra_SciRep.pdf`).

The physical investigation studies a **Titanium–Nickel (TiNi)** single crystal undergoing constant-strain-rate uniaxial tension in Molecular Dynamics (MD) simulations. As the crystal box is stretched along the $[100]$ axis:
1. **Elastic Phase (Austenite)**: The crystal deforms elastically; tensile stress and force rise smoothly with quadratic energy buildup.
2. **Phase Transformation (Martensitic Transition)**: At a critical force threshold $f^\ddagger$, the parent austenite phase abruptly shears into the twinned martensite phase.
3. **Snapback & Compression**: Because the martensitic lattice is geometrically shorter along the loading direction than the stretched simulation box, the crystal snaps into momentary compression (force drops below zero to $\approx -45\text{ pN}$) before reloading.
4. **Thermal Stochasticity**: Due to thermal vibrations at $T = 300\text{ K}$, the critical transition force $f^\ddagger$ is not a single deterministic value, but a stochastic distribution across repeated simulation runs.

### 1.2 System Scope & The Four Pillars
The codebase bridges raw nanomechanical simulation data, statistical inference, PDE physics simulations, and automated curve analysis through four distinct versions:

| Version | Name | Primary Functionality |
| :--- | :--- | :--- |
| **V1** | **Basic Physics Pipeline** | Ingests 100 raw MD force traces, validates grid consistency, computes ensemble mean $\langle f(t) \rangle$, fits the force rate $\dot{f}$, identifies prototype transition events, and evaluates the cubic free-energy landscape. |
| **V2** | **The Inverse Problem** | Maximum Likelihood Estimation (MLE) of the underlying microscopic landscape parameters $(U^\ddagger, \xi^\ddagger, \Gamma_0)$ from the observed critical-force distribution $\{f^\ddagger_i\}$, complete with profile likelihoods, bootstrap intervals, and synthetic recovery tests. |
| **V3** | **Forward Smoluchowski Model** | Numerical solution of the time-dependent overdamped Fokker–Planck (Smoluchowski) PDE for the probability density $P(\xi, t)$ moving across the tilted cubic potential under dynamic force ramp $\dot{f}t$. |
| **V4** | **Inflect Universal Engine** | Instrument- and domain-agnostic tabular curve analysis. Ingests any numeric table, infers dialects and column semantics, pinpoints transition onsets using a locally detrended step statistic, partitions regimes via Dynamic Programming, singles out cohort outliers, and generates audit-verifiable scientific reports. |

---

## 2. End-to-End System Architecture

### 2.1 Full-Stack Component Blueprint

```
+-----------------------------------------------------------------------------------------+
|                                    FRONTEND (Browser)                                   |
|                             React 18 + Vite + TypeScript                                |
|                                                                                         |
|  [#traces]                     [#inverse]               [#forward]         [#inflect]   |
|  Dataset, Traces,              Likelihood Slices,       Smoluchowski       Stage, Beats,|
|  Average, Potential            Bootstrap, Table 1       PDE Animation      Chorus, Out- |
|  Panels                        Comparison               Viewer             lier Cards   |
+-----------------------------------------------------------------------------------------+
                                           ▲
                                           │ HTTP / JSON / Multipart
                                           ▼
+-----------------------------------------------------------------------------------------+
|                                     BACKEND (API)                                       |
|                                    FastAPI + NumPy                                      |
|                                                                                         |
|   /api/dataset/*   /api/traces/*   /api/inverse/*   /api/forward/*   /api/inflect/*     |
|   +--------------+ +-------------+ +--------------+ +--------------+ +----------------+ |
|   | V1 Pipeline  | | V1 Stats &  | | V2 Inverse   | | V3 Forward   | | V4 Inflect     | |
|   | (6 stages)   | | Potential   | | (MLE & Fit)  | | (PDE Solver) | | (Detrend & DP) | |
|   +--------------+ +-------------+ +--------------+ +--------------+ +----------------+ |
+-----------------------------------------------------------------------------------------+
                                           ▲
                                           │ Atomic File Operations
                                           ▼
+-----------------------------------------------------------------------------------------+
|                                  PERSISTENCE LAYER                                      |
|                                                                                         |
|   data/raw/Force_traces/        artifacts/                                              |
|   (100 MD files, .dat)          traces.npz, checkpoints.json, progress.json,            |
|                                 inverse/runs/, forward/runs/, inflect/sessions/         |
+-----------------------------------------------------------------------------------------+
```

### 2.2 Directory Hierarchy & Responsibilities

```
TiNi_Paper/
├── backend/                         # Python 3.11+ computational engine
│   ├── tini/
│   │   ├── __init__.py
│   │   ├── __main__.py              # CLI entry point (run, serve, status, forward, inverse)
│   │   ├── api.py                   # FastAPI application & route declarations
│   │   ├── checkpoints.py           # Content-hash fingerprinting for pipeline resume
│   │   ├── config.py                # Physical constants, settings, paper Table 1 data
│   │   ├── dataset.py               # Discovery, text parsing, and loading of raw MD files
│   │   ├── io_atomic.py             # Atomic file writes (temp + os.replace + .prev backup)
│   │   ├── pipeline.py              # Orchestration of the 6 core processing stages
│   │   ├── potential.py             # Cubic landscape U0(ξ), tilt, barrier ΔU‡(f)
│   │   ├── progress.py              # Real-time progress tracker written to progress.json
│   │   ├── statistics.py            # Ensemble statistics, OLS force rate, peak picking
│   │   ├── validation.py            # Per-file and cross-file tabular integrity checks
│   │   ├── forward/                 # Version 3: Forward Smoluchowski PDE Solver
│   │   │   ├── solver.py            # Finite volume Scharfetter-Gummel + Backward Euler
│   │   │   ├── runs.py              # Run coordinator, snapshot caching, convergence tests
│   │   │   └── validation.py        # Analytic first-passage benchmarks & checks
│   │   ├── inverse/                 # Version 2: Maximum Likelihood Inference
│   │   │   ├── data.py              # Critical-force sample loader & validation
│   │   │   ├── density.py           # Numerical evaluation of p(f|f_dot)
│   │   │   ├── diagnostics.py       # KS test, Anderson-Darling, residual mass check
│   │   │   ├── fit.py               # Multi-start Nelder-Mead + bounded L-BFGS-B polish
│   │   │   ├── likelihood.py        # Log-likelihood function with overflow protection
│   │   │   ├── model.py             # Dudko-Hummer-Szabo / Kramers rate physics
│   │   │   ├── runs.py              # Run orchestration, profiles, bootstrap, synthetic
│   │   │   ├── synthetic.py         # Ground-truth sample generation & parameter recovery
│   │   │   └── uncertainty.py       # Profile likelihood intervals & bootstrap percentiles
│   │   └── inflect/                 # Version 4: Universal Curve Analysis Engine
│   │       ├── chorus.py            # Multi-curve alignment, sparklines & cohort visualization
│   │       ├── columns.py           # Semantic column classification & (X, Y) ranking
│   │       ├── ensemble.py          # Cohort statistics & robust MAD outlier detection
│   │       ├── findings.py          # Tiered findings ledger (measured, read, concluded)
│   │       ├── ingest.py            # Sniffer for comment prefixes, delimiters, headers
│   │       ├── measure.py           # Curve property measurements (stiffness, dynamic range)
│   │       ├── record.py            # SHA256 integrity verification document generator
│   │       ├── segment.py           # Detrended step statistic & DP piecewise polynomial fit
│   │       ├── sessions.py          # Session workspace manager on disk
│   │       ├── transitions.py       # Narration beat generator & chart annotation creator
│   │       └── uncertainty.py       # Moving-block bootstrap & 16-setting stability sweep
│   └── tests/                       # 210 automated unit, benchmark, and regression tests
├── frontend/                        # React 18 + Vite + TypeScript application
│   ├── src/
│   │   ├── App.tsx                  # Hash router, navigation bar, master shell
│   │   ├── main.tsx                 # DOM root mount
│   │   ├── api/                     # Typed client wrappers for all backend endpoints
│   │   ├── components/              # V1 panels (Dataset, Trace, Average, Landscape, Events)
│   │   │   ├── forward/             # V3 Smoluchowski PDE interactive visualizer
│   │   │   ├── inverse/             # V2 Inverse problem workspace, profiles & comparison
│   │   │   └── inflect/             # V4 Stage, Narration, Columns, Chorus, Ledger
│   │   ├── lib/                     # Number formatting and physics helper utilities
│   │   └── styles/                  # Design tokens, typography, and responsive CSS
├── data/raw/Force_traces/           # 100 raw molecular dynamics traces (.dat)
├── artifacts/                       # Pipeline products, checkpoints, and cached runs
└── docs/                            # Physics derivation notes and technical documentation
```

### 2.3 Resumability, Fingerprinted Checkpoints & Atomic I/O
- **Resumability (`pipeline.py`, `checkpoints.py`)**: Long computations can be killed and restarted safely. Each pipeline stage calculates a fingerprint combining:
  1. The raw dataset manifest (file names, sizes, modification times).
  2. The configuration parameters relevant to that stage.
  3. The SHA256 code hash of the Python source files implementing that stage.
  If the fingerprint matches `artifacts/checkpoints.json` and the target files exist, the stage is skipped in under $1\text{ ms}$.
- **Atomic I/O (`io_atomic.py`)**: All JSON, NPY, NPZ, and CSV files are written to a temporary sibling file (`.<target>.tmp.<uuid>`) and renamed via `os.replace`. If an existing valid file was present, it is backed up as `.<target>.prev`. Crashes or power loss never leave corrupted files on disk.

---

## 3. Pillar 1: Data Pipeline & Basic Physics Model (Version 1)

### 3.1 The Six Resumable Pipeline Stages
Pipeline execution follows six sequential, deterministic stages:

```
[1. inspect] ──► [2. validate] ──► [3. preprocess] ──► [4. statistics] ──► [5. potential] ──► [6. charts]
```

1. **`inspect`**: Discovers files matching `property.T300.*.dat`. Verifies row counts ($997$), header formatting, and measures the box extension rate $\frac{dL_x}{dt} = 2.3515 \times 10^{-3}\text{ \AA/ps}$. Compares this against the Maitra paper's loading rate **(v)** ($2.352 \times 10^{-3}\text{ \AA/ps}$), confirming agreement to within $0.02\%$. Outputs `inspection.json`.
2. **`validate`**: Performs checks on time monotonicity, uniform grid spacing ($\Delta t = 0.64\text{ ps}$), box dimension limits ($L_x \in [60.199, 61.698]\text{ \AA}$), absence of non-finite numbers (NaN, Inf), and ensures all traces align to the same time coordinates. Outputs `validation.json`.
3. **`preprocess`**: Converts each raw ASCII file into an individual binary `traces/<id>.npy`. Once all files are processed, stacks them into a single 3D array of shape $(100, 997, 3)$ stored in `traces.npz`, and creates `files.csv`.
4. **`statistics`**: Computes ensemble metrics across the 100 traces: $\langle f(t) \rangle$, sample standard deviation $\sigma_f(t)$, standard error of the mean (SEM), and percentiles ($10\%, 25\%, 50\%, 75\%, 90\%$). Fits the force rate $\dot{f}$, identifies prototype peaks, and outputs `average_curves.csv`, `force_rate.json`, `events.json`, and `events.csv`.
5. **`potential`**: Constructs the paper's cubic free-energy landscape $U_0(\xi)$, landscape force $F(\xi) = -dU_0/d\xi$, tilt under force, and remaining barrier $\Delta U^\ddagger(f)$. Outputs `potential.json` and `potential_curves.csv`.
6. **`charts`**: Generates high-resolution static PNG figures of all traces, average curves, force-rate regressions, and potential curves in `artifacts/charts/`.

### 3.2 Physical Formulations & Equations

#### A. Force Loading Rate $\dot{f}$
The paper defines the imposed loading rate $\dot{f}$ through Eq. (2):
$$\langle f(t) \rangle \approx \dot{f} t$$
In `statistics.py`, $\dot{f}$ is obtained via ordinary least squares (OLS) regression over the time window $t \in [0, W]$. The window width $W$ is a prototype assumption. Evaluating sensitivity across windows demonstrates a stable plateau:

| Window $W$ | Fitted $\dot{f}$ (pN/ps) | $R^2$ | Physical Interpretation |
| :--- | :--- | :--- | :--- |
| $25\text{ ps}$ | $0.0762$ | $0.892$ | Initial acoustic transient / equilibration |
| $50\text{ ps}$ | $0.0925$ | $0.961$ | Elastic regime |
| **$100\text{ ps}$ (Default)** | **$0.0943 \pm 0.0013$** | **$0.973$** | **Agrees with paper's rate ($0.09452\text{ pN/ps}$)** |
| $150\text{ ps}$ | $0.0918$ | $0.968$ | Elastic regime |
| $200\text{ ps}$ | $0.0394$ | $0.512$ | Breakdown: first phase transitions begin |

#### B. The Cubic Free-Energy Landscape
The paper models the zero-force reaction path along an internal order parameter $\xi$ as a cubic polynomial:
$$U_0(\xi) = \frac{U^\ddagger}{2} + \left(\frac{3U^\ddagger}{2\xi^\ddagger}\right)\left(\xi - \frac{\xi^\ddagger}{2}\right) - \left(\frac{2U^\ddagger}{{\xi^\ddagger}^3}\right)\left(\xi - \frac{\xi^\ddagger}{2}\right)^3$$
Boundary conditions:
- Austenite minimum: $U_0(0) = 0$
- Transition state: $U_0(\xi^\ddagger) = U^\ddagger$

Under mechanical force $f$, the potential tilts:
$$U(\xi, f) = U_0(\xi) - f\xi$$

The maximal turnover (critical) force where the energy barrier vanishes:
$$f_c \equiv \frac{3U^\ddagger}{2\xi^\ddagger}$$

The remaining activation energy barrier under applied force $f$ ($0 \le f \le f_c$):
$$\Delta U^\ddagger(f) = U^\ddagger \left(1 - \frac{f}{f_c}\right)^{3/2}$$

#### C. Intrinsic Landscape Force
Derived by elementary differentiation:
$$F(\xi) = -\frac{dU_0}{d\xi} = -\frac{3U^\ddagger}{2\xi^\ddagger} + \frac{6U^\ddagger}{{\xi^\ddagger}^3}\left(\xi - \frac{\xi^\ddagger}{2}\right)^2$$
$F(0) = F(\xi^\ddagger) = 0$. The minimum restorative force $-f_c$ occurs at the inflection point $\xi = \xi^\ddagger / 2$. When the externally applied force reaches $f_c$, the local minimum coalesces with the local maximum, eliminating the barrier.

### 3.3 Prototype Peak Picker vs. Physical Quantities
In the raw MD traces, thermal noise ($\sigma \approx 12\text{ pN}$) is larger than the local signal. To identify the critical event time $t^\ddagger$, the V1 pipeline applies a centered moving average over 15 points ($9.6\text{ ps}$) followed by an argmax. To ensure transparency, three numbers are tracked per trace:
- `f_crit_from_rate_pN`: $\dot{f} \cdot t^\ddagger$ (The paper's formal definition).
- `f_peak_smoothed_pN`: The smoothed force at the peak.
- `f_peak_raw_pN`: The largest single raw sample (noise-inflated).

Across the 100 traces: $\langle t^\ddagger \rangle = 196 \pm 32\text{ ps}$, yielding $\langle f^\ddagger \rangle = 18.5 \pm 3.0\text{ pN}$.

---

## 4. Pillar 2: The Inverse Problem — Inferring the Landscape (Version 2)

### 4.1 Theoretical Foundation: Kramers Rate & Critical-Force Distribution
The inverse problem deduces the microscopic landscape parameters:
$$w = \{U^\ddagger, \xi^\ddagger, \Gamma_0\}$$
from the observed distribution of critical forces $\{f^\ddagger_i\}_{i=1}^{100}$.

Under Kramers transition theory for barrier escape:
- **Escape Rate $\Gamma(f)$**:
  $$\Gamma(f) = \Gamma_0 \left(1 - \frac{f}{f_c}\right)^{1/2} \exp\left[\frac{U^\ddagger}{k_B T} \Delta(f)\right], \quad \text{where } \Delta(f) = 1 - \left(1 - \frac{f}{f_c}\right)^{3/2}$$
- **Survival Probability $\psi(f)$**: The probability that the phase transition has not yet occurred when force reaches $f$:
  $$\psi(f) = \exp\left\{ \mu_0 \left[1 - \exp\left(\frac{U^\ddagger}{k_B T} \Delta(f)\right)\right] \right\}, \quad \text{where } \mu_0 = \frac{\Gamma_0 k_B T}{\dot{f} \xi^\ddagger}$$
- **Probability Density Function $p(f \mid \dot{f})$**:
  $$p(f \mid \dot{f}) = -\frac{d\psi}{df} = \frac{\Gamma(f)}{\dot{f}} \psi(f)$$

### 4.2 Numerical Inference Engine: Multi-Start Nelder-Mead & L-BFGS-B Polish
The log-likelihood of observing a critical force sample $\{f^\ddagger_i\}_{i=1}^S$ is:
$$\ln L(w) = \sum_{i=1}^S \ln p(f^\ddagger_i \mid \dot{f}; w)$$
Minimizing the Negative Log-Likelihood ($\text{NLL} = -\ln L$):
1. **Unconstrained Parameterization**: Optimizes in logarithmic space $\theta = (\ln U^\ddagger, \ln \xi^\ddagger, \ln \Gamma_0)$ to enforce positivity.
2. **Overflow Safeguard**: In computing $\mu_0 \exp(\beta U^\ddagger \Delta)$, exponents are clipped at $700$ (just under float64 overflow $\approx 1.7 \times 10^{308}$). Any parameter set where $f_c \le \max(f^\ddagger_i)$ receives an infinite penalty.
3. **Multi-Start Simplex Search**: Nelder-Mead is run from multiple starting points distributed across physical scales. Because Nelder-Mead is derivative-free, it is unaffected by penalty walls.
4. **Gradient Polish**: The best simplex vertex is polished using bounded L-BFGS-B with finite-difference gradients.

### 4.3 Profile Likelihoods, Bootstrap & Synthetic Recovery
- **Profile Likelihoods**: For each parameter $\theta_k \in \{\ln U^\ddagger, \ln \xi^\ddagger, \ln \Gamma_0\}$, the parameter is fixed across a grid while optimizing the remaining two. The 95% confidence interval corresponds to:
  $$\Delta \text{NLL} = \text{NLL}(\theta_k) - \text{NLL}_{\min} \le \frac{\chi^2_{1, 0.95}}{2} \approx 1.92$$
- **Non-Parametric Bootstrap**: Resamples the 100 empirical critical forces with replacement ($B = 200$), re-fitting the full model on each replicate to compute empirical standard errors.
- **Synthetic Recovery**: Inverse transform sampling generates synthetic force datasets from known ground-truth parameters. Re-fitting verifies that the optimization routine recovers the input parameters without systematic bias.
- **Goodness-of-Fit Diagnostics**: Evaluates Kolmogorov–Smirnov (KS) and Anderson–Darling statistics, and computes the residual mass $\psi(f_c)$ (the probability that a trajectory fails to transition thermally before the barrier vanishes).

---

## 5. Pillar 3: The Forward Smoluchowski Model (Version 3)

### 5.1 The Time-Dependent Overdamped Fokker-Planck (Smoluchowski) PDE
The forward model integrates the continuum probability density $P(\xi, t)$ of the crystal's reaction coordinate $\xi$ across time:
$$\frac{\partial P}{\partial t} = -\frac{\partial J}{\partial \xi}$$
where the probability flux $J(\xi, t)$ is defined by:
$$J(\xi, t) = -D \left[ \frac{\partial P}{\partial \xi} + \beta \left(\frac{\partial U}{\partial \xi}\right) P \right], \quad \beta = \frac{1}{k_B T}, \quad D = \frac{k_B T}{\eta}$$
The potential $U(\xi, t) = U_0(\xi) - \dot{f}t\xi$ changes dynamically as the force ramp increases.

### 5.2 Elimination of Free Parameters (Deriving $\eta$ and $D$)
Rather than introducing friction $\eta$ as an unconstrained tuning parameter, it is linked to the paper's Kramers rate prefactor $\Gamma_0$:
$$\Gamma_0 = \frac{1}{2\pi \eta} \left(\frac{6U^\ddagger}{{\xi^\ddagger}^2}\right) \exp\left(-\frac{U^\ddagger}{k_B T}\right) \implies \eta = \frac{6U^\ddagger}{2\pi \Gamma_0 {\xi^\ddagger}^2} \exp\left(-\frac{U^\ddagger}{k_B T}\right)$$
This yields diffusion coefficient $D = k_B T / \eta$. For Table 1 parameters: $\eta \approx 0.368\text{ pN}\cdot\text{ps/\AA}$, $D \approx 113\text{ \AA}^2/\text{ps}$, well relaxation time $\tau_{\text{well}} \approx 0.08\text{ ps}$, and diffusion time $\tau_{\text{diff}} \approx 7.6\text{ ps}$.

### 5.3 Numerical Discretization: Scharfetter-Gummel Flux & Backward Euler
1. **Domain & Boundaries**: $\xi \in [\xi_L, \xi_A]$ with $N = 250$ finite volume cells.
   - Left Boundary ($\xi_L = -0.6 \xi^\ddagger$): Reflecting wall ($J(\xi_L, t) = 0$).
   - Right Boundary ($\xi_A > \xi^\ddagger$): Absorbing sink ($P(\xi_A, t) = 0$).
2. **Scharfetter-Gummel Interface Flux**: Naive central differencing of advective-diffusive flux produces spurious oscillations when drift dominates. The Scharfetter-Gummel scheme uses the exact local Bernoulli weight:
   $$J_{i+1/2} = -\frac{D}{h} \left[ B(-\Delta u) P_{i+1} - B(\Delta u) P_i \right], \quad B(z) = \frac{z}{e^z - 1}$$
   where $\Delta u = \beta (U_{i+1} - U_i)$.
3. **Time Integration**: Implicit Backward Euler ($\theta = 1.0$), generating a tridiagonal linear system solved at every time step with `scipy.linalg.solve_banded`.
4. **Exact Conservation**:
   $$\sum_{i=1}^N P_i(t) h + M_{\text{absorbed}}(t) \equiv 1.0$$
   Guaranteed to machine precision without numerical clipping or renormalization.
5. **Critical Force Density**: The rate of mass absorption at the absorbing boundary yields the theoretical first-passage density:
   $$P_{\text{first-passage}}(t) = J(\xi_A, t) \implies p_{\text{forward}}(f) = \frac{J(\xi_A, f/\dot{f})}{\dot{f}}$$
   which matches the analytical density from Version 2 and the empirical MD histogram from Version 1.

---

## 6. Pillar 4: Inflect — Universal Tabular Curve Analysis (Version 4)

### 6.1 The Generalization Paradigm
While Versions 1–3 focus on TiNi force traces and cubic potentials, Version 4 (**Inflect**) is an autonomous curve-analysis engine that generalizes to **any tabular numeric dataset** (mechanical testing, spectroscopic scans, thermal transitions, rheology, etc.). It automates dialect parsing, semantic column detection, transition identification, regime fitting, cohort outlier detection, and audit reporting.

### 6.2 Step 1: Ingestion & Dialect Sniffing (`ingest.py`)
Upon receiving uploaded file bytes:
- **Comment Detection**: Detects prefixes (`#`, `%`, `//`, `!`, `;`).
- **Delimiter Detection**: Evaluates candidates (comma, tab, semicolon, pipe, whitespace) by measuring column count consistency across the first 60 lines.
- **Header Parsing**: Extracts column names and parses embedded units (e.g., `Force [pN]`, `lx(2)`, `strain(5)`).
- **Missing Data Handling**: Filters NaNs, infinities, and unparseable rows cleanly.

### 6.3 Step 2: Column Intelligence, Semantics & Ranking (`columns.py`)
For multi-column datasets (e.g. 21-column LAMMPS logs), Inflect ranks all columns for their suitability as controlled variable ($X$) and response ($Y$):
- **Physical Vocabulary Classification**: Matches column headers against regex dictionaries:
  - `time`: `t`, `time`, `step`, `frame`
  - `strain`: `strain`, `epsilon`, `eps`, `elongation`
  - `stress`: `stress`, `sigma`, `-pxx`, `virial`
  - `force`: `force`, `load`, `f`, `tension`
  - `energy`: `energy`, `pe`, `ke`, `etotal`, `enthalpy`
- **Monotonicity & Uniformity**: Computes the monotonic fraction and step variance.
  - *Disambiguation*: If column `T` is strictly monotonic, it is classified as `time` ($X$-axis candidate). If it fluctuates around a setpoint, it is classified as `temperature` ($Y$-axis candidate).
- **Scoring**: Monotonic, regular columns receive high $X$-scores; columns with large dynamic range and physical response keywords receive high $Y$-scores.
- **Thinning**: All columns are sub-sampled to 140 points on identical row indices, providing immediate sparkline previews in the UI within a lightweight 41 KB payload.

### 6.4 Step 3: Transition & Inflection Detection (`segment.py`)

#### Why Onset, Not Peak?
Standard curve analysis algorithms search for peak maxima ($\max y$). In experimental and MD data:
- **Peaks are noise artifacts**: The highest single point is governed by thermal fluctuations and shifts depending on the smoothing filter applied.
- **The onset is physically invariant**: The onset represents the moment the lattice or specimen leaves its stable regime.
- *Example*: In test trace `00005.dat`, the peak stress is $-0.725\text{ GPa}$ at $1.84\%$ strain (a noisy sample), whereas the true structural onset occurs at $-0.566\text{ GPa}$ at $2.15\%$ strain. Inflect identifies and marks the onset.

```
       Response Y
           ▲
           │          Noise Peak (Filter Artifact)
           │             *
           │            / \       Onset Point [x0, y0] (True Physical Transition)
           │    /\     /   \     ●
           │   /  \   /     \   / \
           │  /    \_/       \_/   \
           │ /                      \
           │/                        \  Transition Drop
           │                          \
           │                           \   Settled Point [x1, y1]
           │                            \ ●────────────────────
           │                              Subsequent Regime
           └─────────────────────────────────────────────────────► Control X
```

#### The Locally Detrended Step Statistic
Traditional derivative thresholding fails when a curve has a nonlinear background (e.g., quadratic elastic energy $y \propto x^2$, where the derivative $\frac{dy}{dx} \propto 2x$ grows forty-fold before the transition).

Inflect introduces a **locally detrended step statistic**:
1. At each point $x_i$, fit an ordinary linear regression to the $w$ points before: $[i-w, i)$.
2. Fit an ordinary linear regression to the $w$ points after: $[i, i+w)$.
3. Extrapolate both lines to $x_i$ and compute the difference:
   $$\text{Step}(x_i) = \hat{y}_{\text{right}}(x_i) - \hat{y}_{\text{left}}(x_i)$$
4. **Mathematical Cancellation**: For any smooth curve (regardless of slope or curvature), the left and right Taylor expansions match to first order. Thus, $\text{Step}(x_i) \approx 0$ on smooth regions. Only a genuine physical step or discontinuity produces a non-zero spike ($>10\sigma$).
5. **Multi-Scale Window Ladder**: Evaluates window widths $w \in \{N/60, N/30, N/15\}$ to capture both sharp drops and broader transitions.

#### Geometric Cross Test (Knees vs. Steps)
To prevent sharp bends (knees) from being misidentified as steps:
- If two trendlines intersect near the boundary, the curve exhibits a change in slope (a knee).
- If the trendlines do not intersect near the boundary, the curve exhibits a genuine discontinuity (a step transition).

### 6.5 Step 4: Optimal Regime Partitioning via Dynamic Programming
Once transition events are isolated, the remaining smooth stretches are partitioned into optimal polynomial regimes (degree 0: constant, degree 1: linear, degree 2: quadratic):
- Segment RSS values for any interval $[j, m]$ are computed in $\mathcal{O}(1)$ time using precalculated prefix moment sums ($S_p = \sum x^p, T_p = \sum x^p y$).
- Centered coordinates $u = x - x_{\text{mid}}$ are used to prevent numerical precision loss in quadratic fits.
- Global Dynamic Programming determines the exact optimal breakpoint configuration without greedy approximations.
- A BIC-style penalty prevents unnecessary segment splitting.

### 6.6 Step 5: Narration & Stage Beat Generation (`transitions.py`)
Inflect translates segmentation results into human-readable scientific prose organized into discrete **beats**:
- Each beat produces a sentence containing interactive number slots (e.g. *"The curve steps down by **0.60 GPa** at **2.20 %** strain"*).
- The backend pairs each beat with explicit SVG chart annotations:
  - Shaded transition regions.
  - Circled onset $\mathbf{(x_0, y_0)}$ and settled $\mathbf{(x_1, y_1)}$ points.
  - Step magnitude brackets.
  - Slope triangles on linear elastic regimes.
- The UI camera smoothly pans and zooms to the region of interest for each beat.

### 6.7 Step 6: Multi-Curve Chorus & Cohort Outlier Analysis (`chorus.py`, `ensemble.py`)
When multiple files are uploaded together:
- **Chorus View**: All curves are rendered simultaneously on a single axis, with the cohort median and interquartile ribbon overlaid.
- **Transition Alignment**: A toggle shifts every curve along the $x$-axis to align its own transition onset at $x = 0$, allowing direct visual comparison of post-transition dynamics.
- **Robust Outlier Detection**: Computes median and Median Absolute Deviation (MAD) for onset position, step magnitude, range, stiffness, and noise.
  - *Real-World Validation*: In a 296-run TiNi compression dataset, Inflect automatically identifies files `00065`, `00177`, and `00185` as outliers without prior supervision. These runs experienced an early phase-slip into a secondary lattice orientation, causing a five-fold increase in sustained stress.

### 6.8 Step 7: Uncertainty, 16-Setting Stability Sweep & Ledger Audit
- **Moving-Block Residual Bootstrap**: Preserves the transition geometry, estimates residual autocorrelation length, resamples residuals in blocks, and re-runs the full detection and partitioning pipeline across replicates to obtain true 95% confidence intervals.
- **16-Setting Stability Sweep**: Tests 6 detection thresholds, 5 detail levels, and 5 segment counts. Displays a stability strip: aligned vertical marks confirm that the identified transition is an inherent feature of the data rather than a parameter artifact.
- **The Scientific Ledger (`findings.py`)**: Catalogs every finding into:
  - `measured`: Directly calculated by a deterministic algorithm.
  - `read`: Structural classification inferred by rule.
  - `concluded`: High-level scientific deduction.
- **Self-Verifying Record (`record.py`)**: Packages the code commit hash, data hashes, and parameter settings into an audit record with a one-click verification endpoint (`POST /verify`).

---

## 7. Frontend Architecture & Interactive Experience

### 7.1 Tech Stack & Design System
- **Framework**: React 18, TypeScript, Vite.
- **Visualization**: Custom responsive SVG canvases, Recharts, KaTeX for LaTeX equations.
- **Design Language**: Follows the Keystone scientific design principles:
  - Clean light-theme typography.
  - High-contrast terracotta accents for measured empirical data.
  - Slate accents for theoretical models.
  - Interactive parameter controls embedded directly inside explanatory sentences.

### 7.2 Component Tree & View Routing
Navigation relies on standard URL hash routing (`#traces`, `#inverse`, `#forward`, `#inflect`):

```
App.tsx
├── Navigation Bar (Links: 1. Force traces, 2. Inverse problem, 3. Forward model, 4. Inflect)
├── ErrorBoundary
│   ├── [#traces]  TracesPage
│   │   ├── StatusStrip (Run, Resume, Redo buttons + progress bar)
│   │   ├── DatasetPanel (File manifest, raw row viewer)
│   │   ├── TracePanel (Single trace viewer, zoom & pan)
│   │   ├── AveragePanel (Ensemble average curve, force rate slider W)
│   │   ├── EventsPanel (Transition histograms, critical force scatter)
│   │   ├── LandscapePanel (Cubic potential, tilt slider f/fc)
│   │   └── SummaryPanel (Executive metrics, Paper Table 1 comparison)
│   │
│   ├── [#inverse] InversePage
│   │   ├── OverviewPanel (Equations 1-8, derivation notes)
│   │   ├── ObservedPanel (Empirical critical-force histogram)
│   │   ├── ModelPanel (Theoretical density curve, parameter sliders)
│   │   ├── WorkspacePanel (Multi-start fit launcher, profile likelihood generator)
│   │   ├── ResultsPanel (MLE parameters, log-likelihood, convergence status)
│   │   ├── ComparisonPanel (Side-by-side comparison with Paper Table 1)
│   │   └── RecordPanel (JSON audit export)
│   │
│   ├── [#forward] ForwardPage
│   │   ├── Parameter Selector (Paper MLE, Paper LSQ, or V2 MLE)
│   │   ├── Time Slider & Playback Controller
│   │   ├── Distribution Canvas (P(ξ, t) evolving on tilted potential)
│   │   └── Comparison Plot (Forward first-passage density vs. MD histogram)
│   │
│   └── [#inflect] InflectPage
│       ├── Intake (File dropzone, sample loader)
│       ├── Columns (Semantic column classifier cards, axis chooser)
│       ├── Stage (Interactive SVG chart with animated annotation marks)
│       ├── Narration (Beat stepper rail, interactive slot inputs)
│       ├── Chorus (Multi-curve overlay, transition alignment toggle)
│       ├── Ensemble (Cohort statistics, MAD outlier cards)
│       ├── Confidence (95% bootstrap intervals, 16-setting stability strip)
│       ├── Ledger (Tiered scientific findings table, user notes)
│       ├── Export (SVG, CSV, and publication-ready Methods text)
│       └── Record (SHA256 reproducible integrity check)
```

---

## 8. End-to-End User Journey Walkthrough

### 8.1 File Upload & Interactive Analysis Flow
Here is what happens step-by-step when a user interacts with the system:

```
[User Drops File]
       │
       ▼
[POST /api/inflect/sessions]
       │
       ├── Sniff bytes, headers, delimiters, comments (ingest.py)
       └── Score columns for X and Y roles (columns.py)
       │
       ▼
[UI Displays Column Chooser]
       │
       ├── User views sparkline previews and reasoning
       └── User clicks "Accept & Read Curve"
       │
       ▼
[GET /api/inflect/sessions/{id}/curve]
       │
       ├── 1. Compute rolling detrended step statistic across window ladder
       ├── 2. Perform geometric cross test to distinguish knees from steps
       ├── 3. Locate transition onset [x0, y0] and settled point [x1, y1]
       ├── 4. Fit optimal polynomial regimes via dynamic programming
       └── 5. Construct narration beats and SVG annotation coordinates
       │
       ▼
[UI Stage Displays Interactive Curve]
       │
       ├── User navigates narration beats via keyboard arrows or stepper dots
       ├── Canvas pans, zooms, and highlights active features (onset, drop bracket, slope)
       └── User can adjust regime count directly within the narration sentence
       │
       ▼
[GET /api/inflect/sessions/{id}/ledger]
       │
       ├── Run moving-block residual bootstrap (95% confidence intervals)
       └── Run 16-setting parameter sweep (stability strip)
       │
       ▼
[User Exports Findings]
       └── Downloads vector SVG, results CSV, or formatted Methods text
```

### 8.2 Parameter Sweeps & Re-verification Flow
- **Modifying Settings**: When the user edits a parameter (such as segment count $k$ or the force-rate window $W$), the frontend submits the change to the API, which re-evaluates the $\mathcal{O}(1)$ prefix moment fits in milliseconds without reloading the raw data.
- **Reproducibility Verification**: Clicking **Verify integrity** triggers `POST /api/inflect/sessions/{id}/verify`. The backend recomputes the SHA256 hashes of the source data, pipeline code, and output tables, reporting whether the analysis matches the archived record.

---

## 9. Validation, Test Suite & How to Run

### 9.1 Test Battery (210 Passing Tests)
The backend contains a test suite of 210 automated tests verifying physics identities, numerical solvers, and data analysis pipelines:

```bash
cd backend
python -m pytest
```

Test suite coverage:
- `test_potential.py`: Verifies cubic potential derivatives, stationary points, barrier reduction, and Table 1 critical forces.
- `test_pipeline.py`: Verifies the 6-stage pipeline, atomic I/O, checkpoint fingerprints, and resumability.
- `test_inverse_model.py`: Validates Kramers rates, survival probabilities, PDF integrals, and Eq. (8) approximations.
- `test_inverse_fit.py`: Tests multi-start Nelder-Mead optimization, L-BFGS-B polish, and parameter recovery.
- `test_forward.py`: Tests Scharfetter-Gummel flux, boundary conditions, and exact probability conservation ($\sum P_i h + M_{\text{absorbed}} = 1$).
- `test_forward_runs.py`: Tests PDE time stepping, grid convergence, and first-passage density calculations.
- `test_inflect_ingest.py`: Tests dialect sniffer across messy CSV, TSV, pipe, and whitespace tables.
- `test_inflect_preview.py`: Tests semantic column classification, regular spacing checks, and sparkline downsampling.
- `test_inflect_segment.py`: Validates the detrended step statistic, knee-vs-step differentiation, and DP segmentation.
- `test_inflect_reading.py`: Tests narration beat generation, sentence interpolation, and annotation placement.
- `test_inflect_uncertainty.py`: Tests moving-block bootstrap and 16-setting parameter stability sweeps.
- `test_inflect_ledger.py`: Tests tiered findings classification, note attachment, and hash audit records.
- `test_inflect_api.py`: Tests all FastAPI Inflect REST endpoints.

*Status: 210 passed, 0 failures.*

### 9.2 Execution Instructions

#### 1. Backend Server
Requirements: Python 3.11+ with NumPy, SciPy, pandas, matplotlib, FastAPI, uvicorn.
```bash
cd backend
pip install -r requirements.txt
python -m tini serve
```
- API server: `http://localhost:8000`
- Interactive API documentation: `http://localhost:8000/docs`
- Headless pipeline execution: `python -m tini run`

#### 2. Frontend Application
Requirements: Node.js 18+ and npm.
```bash
cd frontend
npm install
npm run dev
```
- Application URL: `http://localhost:5173`
- Direct section navigation:
  - `http://localhost:5173/#traces` $\to$ Version 1 Dashboard
  - `http://localhost:5173/#inverse` $\to$ Version 2 Inverse Model
  - `http://localhost:5173/#forward` $\to$ Version 3 Forward Smoluchowski Model
  - `http://localhost:5173/#inflect` $\to$ Version 4 Inflect Universal Engine

---

*Report generated for the TiNi Research Platform & Inflect Engine codebase.*

