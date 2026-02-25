---
name: git-commit
description: Create well-structured git commits with conventional commit messages
---

When asked to commit changes, follow this workflow:

1. Run `git status` to see modified, added, and deleted files
2. Run `git diff --staged` to review what's staged; if nothing is staged, ask the user what to stage or suggest staging relevant files
3. Analyze the changes and determine the conventional commit type:
   - `feat`: New feature
   - `fix`: Bug fix
   - `docs`: Documentation changes
   - `refactor`: Code restructuring without behavior change
   - `test`: Adding or updating tests
   - `chore`: Maintenance tasks, dependency updates
   - `style`: Formatting, whitespace changes
4. Write a commit message:
   ```
   type(scope): short summary in imperative mood (<72 chars)

   Optional body explaining WHY the change was made.
   ```
5. Run `git commit -m "<message>"` to create the commit
6. Show `git log --oneline -1` to confirm

Keep the summary under 72 characters. Use imperative mood ("add feature" not "added feature").
