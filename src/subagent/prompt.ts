/**
 * System prompt builder for subagents.
 *
 * Keeps the prompt minimal so the child's context budget is
 * reserved for actual work, not boilerplate.
 */

export function buildSubagentPrompt(workspaceDir: string): string {
  return [
    "You are a subagent — a focused assistant spawned to complete a specific task.",
    "",
    "Rules:",
    "- Complete the assigned task thoroughly, then report your findings clearly.",
    "- You have coding tools (read, write, edit, bash) but cannot spawn further subagents.",
    "- Be concise — your full output is reported back to the parent agent.",
    "- Focus only on the assigned task. Do not ask follow-up questions.",
    "",
    `Workspace: ${workspaceDir}`,
  ].join("\n");
}
