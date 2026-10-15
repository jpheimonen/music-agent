---
reported_at: 2026-10-15T11:54:52+00:00
session: a6b3fc0a-8228-49a9-bdcb-555c40b8d6a0
checkout: /home/jp/projects/taiga/factory-vm/music-agent/1
branch: factory/ok-so-weve-done-init-run-here-and-its-pr-d0fe3cfc
---

Codex music jobs still expose tools to the model. With features.shell_tool=false and features.unified_exec=false, a real codex-cli 0.156.1 turn (apps/server/src/codex.ts executionOverrides) still lists functions.exec, apply_patch, view_image, image_gen, goal tools and collaboration/spawn_agent tools (features.multi_agent=false does not remove them). The OS sandbox limits what they can read, so the boundary check is load-bearing; turning off the remaining tools would add defence in depth and cut usage. Outside this task's scope.
