## Multi-Agent Use

Codex should consider multi-agent delegation for every non-trivial task.

Use multi-agent tools when the work has independent subtasks that can run in parallel, such as:
- broad repository investigation
- code review from multiple perspectives
- documentation or solution synthesis
- debugging with separable hypotheses
- large feature planning or implementation with disjoint file ownership
- verification that can run while other work continues

Keep work local when:
- the task is simple, single-file, or mechanical
- the next step depends on one blocking answer
- delegation would duplicate the main agent's work
- parallel work would risk overlapping edits or coordination overhead

Before delegating, Codex should identify the immediate local task and only delegate bounded sidecar tasks that materially advance the request.