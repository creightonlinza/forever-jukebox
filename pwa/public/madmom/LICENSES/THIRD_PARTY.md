# Third-Party Notices

This repository is a composite distribution. Project-owned source code is
BSD 2-Clause. Model/data artifacts under `models/` are CC BY-NC-SA 4.0 and make
model-bearing distributions non-commercial.

## madmom

- Project: https://github.com/CPJKU/madmom
- License: BSD 2-Clause License - Copyright (c) 2012-2014 Department of
  Computational Perception, JKU Linz / OFAI Vienna (see
  `tools/regen/reference/madmom/LICENSE`; full notice reproduced in `NOTICE`).
- Usage: the runtime Rust core (`rust/madmom_beats_port_core/src/`, notably
  `features.rs`, `dbn.rs`, `model.rs`) is a port / derivative work of madmom.
  BSD 2-Clause attribution therefore applies to redistributed source **and**
  binaries (`.so`/`.a`/`.dylib`/`.wasm`). The submodule under `tools/regen/` is
  additionally used for regeneration of models and goldens.

## madmom_models

- Project: https://github.com/CPJKU/madmom_models
- License: CC BY-NC-SA 4.0 (license notice in
  `LICENSES/MODELS_CC_BY_NC_SA.txt`)
- Usage: source for exported model artifacts stored under `models/`. These
  artifacts are non-commercial only and are not covered by the BSD 2-Clause
  source-code license.
