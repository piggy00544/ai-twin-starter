# CI process deadlines

Runtime controllers use `spawn` with an owned, detached process group. Deadline
expiry or combined stdout/stderr overflow sends SIGTERM, followed by SIGKILL
after at most one second. A successful parent exit also cleans any remaining
descendants before the controller returns. Output remains bounded to the caller's
existing byte limit. After group termination, pipes have another 500ms to close;
otherwise the controller rejects and destroys its own pipe streams. Package
acquisition stays outside this runtime controller.

Four executable regressions run inside the OS network boundary: loopback plus
kernel denial after custom lookup and from Python; a SIGTERM-resistant parent
and grandchild; successful parent exit leaving a resistant grandchild with either
ignored or inherited output pipes; and an
output overflow. They verify the owned process group and that both recorded
processes stop. Nested controllers inherit the already established boundary and
Linux dropped privileges; the kernel denial probe still runs without a JavaScript
network preload. There is no unsupported-OS runtime fallback.

These tests add four to the retained TAP minimum. Existing Node memory limits
and the 240-second suite deadline are unchanged. The one-second forced-termination
grace is explicit; full official Host memory policy is separate and unchanged.
Local macOS proof does not establish the hosted Linux result; that requires the
actual CI run for the new commit.
