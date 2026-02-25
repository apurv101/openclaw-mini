---
name: code-review
description: Review code changes for bugs, style issues, and improvement opportunities
---

When asked to review code, follow this approach:

1. **Identify the scope**: Run `git diff` (unstaged), `git diff --staged` (staged), or `git diff main...HEAD` (branch). If a specific file is mentioned, read that file.

2. **Review checklist** — evaluate each area:
   - **Correctness**: Logic errors, off-by-one, null/undefined handling, edge cases
   - **Security**: Input validation, injection risks, credential exposure, path traversal
   - **Performance**: Unnecessary allocations, O(n^2) loops, missing early returns
   - **Readability**: Naming clarity, function length, dead code, misleading comments
   - **Error handling**: Missing try/catch, swallowed errors, unhelpful messages

3. **Output format**:
   ```
   ## Code Review Summary

   ### Critical (must fix)
   - [file:line] Description of issue

   ### Suggestions (should fix)
   - [file:line] Description of improvement

   ### Nitpicks (optional)
   - [file:line] Minor style or preference note

   ### Positive
   - Things done well worth noting
   ```

4. Be specific: reference file names and line numbers. Suggest concrete fixes, not vague advice.
