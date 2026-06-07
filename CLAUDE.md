@AGENTS.md
General Guidelines
Do not run a build unless:
The change is a significant UI modification, and
You are confident that a separate build is required to verify the changes.
Before Making Changes

Before implementing any changes:

Read and understand the relevant project files.
Review related folders, components, and existing implementations to gather context.
Understand the current architecture and coding patterns.
Plan the required changes carefully before starting implementation.
Execute the plan in a clean, structured, and maintainable manner.
Project Stack & Standards

This project uses:

Next.js 16
App Router
SSR (Server-Side Rendering)
SSG (Static Site Generation)
Tailwind CSS
shadcn/ui
Lucide Icons

When implementing features, follow the established patterns and best practices already present in the project.

UI Guidelines

For any UI change or new UI implementation:

Review existing pages, screens, and components before making changes.
Maintain visual consistency with the rest of the application.
Reuse existing patterns, layouts, spacing, typography, and component structures whenever possible.
Prefer shadcn/ui components unless there is a strong reason not to.
Use Lucide icons consistently throughout the application.
Suite-Wide Consistency

This project is part of a larger suite of applications.

For any UI-related work:

Review the other projects within the suite. Mainly Geiger Flow, Geiger Notes
Ensure visual styling, component usage, layouts, and overall user experience remain consistent across all projects.
New UI implementations should feel native to the suite rather than unique to a single project.
Code Quality
Prioritise clean, readable, and maintainable code.
Follow existing project conventions.
Avoid unnecessary complexity.
Keep implementations simple, scalable, and consistent with the current codebase.