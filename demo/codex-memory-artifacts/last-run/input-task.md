# TASK: Issue #101 - Document the ACME password reset flow

## Description
Create docs/answer.md.
Requirements:
- include a short heading
- include three bullets covering identity verification, manager approval for contractors, and tenant-specific handling
- end with a one-line operator takeaway

## Discussion
> Keep it short and operational.
> Use the prior knowledge rather than inventing policy.

## Labels: documentation, password-reset

## Additional Context
This is a demo harness. Keep the diff small and write only the requested answer file.

## Prior Knowledge

### ACME password reset policy (confidence: 0.95)
Always verify the user's identity before starting a reset. Contractor accounts require manager approval before unlocking or resetting.

### Tenant-specific reset guidance (confidence: 0.90)
Password reset notes must explicitly say the workflow is tenant-specific so operators do not reuse the wrong playbook across customers.

## Acceptance Criteria
- Implement the requested change completely
- If the issue names a target file or surface, make the change there or in directly supporting files rather than substituting unrelated improvements
- Run tests and make sure they pass
- Do not change tests unless explicitly required
- Follow existing patterns and keep the diff focused
