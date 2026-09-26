# README practices for Manatee

Research date: 2026-09-27. Primary guidance comes from GitHub and Google's documentation standards. Community recommendations were selected from the 21.5k-star [Awesome README](https://github.com/matiassingers/awesome-readme) collection, whose curated article list includes thoughtbot's _How To Write A Great README_, Tom Preston-Werner's _Readme Driven Development_, and _Elegant READMEs_. Current README files from widely used visual-editor projects provide relevant examples rather than universal rules.

## What strong guidance agrees on

- **Answer the first-time visitor's questions first.** GitHub names five expected answers: what the project does, why it is useful, how to start, where to get help, and who maintains it. Google's package guidance adds current release/status, concrete usage commands, contacts, and links to deeper documentation. [GitHub: About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes) · [Google README style guide](https://google.github.io/styleguide/docguide/READMEs.html)
- **Open with a clear promise, then prove it quickly.** thoughtbot recommends an engaging introductory paragraph, a description of what the project makes easier, installation instructions, and examples. The community-maintained Make a README guide similarly recommends a specific description, differentiators, a minimal usage example, expected output where useful, and explicit requirements. [thoughtbot: How To Write A Great README](https://thoughtbot.com/blog/how-to-write-a-great-readme) · [Make a README](https://www.makeareadme.com/)
- **Keep the README a gateway, not the entire manual.** GitHub says it should contain what is necessary to start using and contributing, with longer material elsewhere; Google requires links to user/team documentation. GitHub also recommends relative repository links because they continue to work in clones and across branches. [GitHub: About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes) · [Google README style guide](https://google.github.io/styleguide/docguide/READMEs.html)
- **Make project maturity and intent explicit.** Google asks READMEs to state whether software is deprecated or not ready for general release. Make a README recommends a visible project-status notice and a roadmap when future direction matters. This prevents a polished page from accidentally implying production readiness. [Google README style guide](https://google.github.io/styleguide/docguide/READMEs.html) · [Make a README](https://www.makeareadme.com/)
- **Use evidence-bearing decoration sparingly.** A build-status badge is useful when it reports a meaningful current signal; thoughtbot warns that a failing badge also shapes trust, and Standard Readme cautions against badge clutter. For a visual application, a real screenshot or short demonstration communicates more than ornamental branding. [thoughtbot: How To Write A Great README](https://thoughtbot.com/blog/how-to-write-a-great-readme) · [Standard Readme](https://github.com/RichardLitt/standard-readme) · [Make a README](https://www.makeareadme.com/)
- **Treat the README as part of product design.** GitHub cofounder Tom Preston-Werner argues that writing the introductory contract exposes unclear purpose and interfaces before implementation. Even for an existing product, that principle suggests describing only current, verified behavior and separating it from future intent. [Readme Driven Development](https://tom.preston-werner.com/2010/08/23/readme-driven-development.html)

## Evidence from successful visual-editor projects

- [Excalidraw's README](https://github.com/excalidraw/excalidraw#readme) leads with a linked product image, one-sentence identity, a product showcase, a scannable capability list, then distinguishes the hosted application from the embeddable package before showing the appropriate quick start. That audience separation avoids giving an app user library-install instructions by accident.
- [tldraw's README](https://github.com/tldraw/tldraw#readme) uses a hero, a precise audience-specific promise, direct documentation/example links, feature highlights, a minimal working example, and separate local-development and contribution sections. It also states its contribution and licensing constraints plainly.
- [Mermaid's README](https://github.com/mermaid-js/mermaid#readme) pairs feature descriptions with concrete diagram examples and links each example to documentation and a live editor. For a diagram product, showing an authored input beside or linked to its result is stronger evidence than an abstract feature claim.

These projects are not templates to copy wholesale. Their transferable pattern is progressive disclosure: identity and a live proof above the fold; current user capabilities next; the smallest successful workflow; then contributor, support, and policy material.

## Recommended Manatee README shape

1. **Project name and one-sentence value proposition.** Say that Manatee is a browser-based visual editor for Mermaid diagrams and name the differentiator in user terms. Avoid implementation technology in the opening sentence.
2. **Trust and action row.** Link prominently to the live editor. Add only badges that answer a real question, such as the `main` verification status and license.
3. **Current product visual.** Use one maintained screenshot or short recording linked to the live app, with descriptive alt text. It should demonstrate the real editor rather than a conceptual mock-up.
4. **Why Manatee.** In one short paragraph, explain the problem: direct visual editing while preserving Mermaid as editable source. State the boundary accurately if some Mermaid constructs are preview-only or not visually editable.
5. **Capabilities.** Group a compact list by workflow rather than internal subsystem—for example authoring, layout/routing, inspection/editing, file persistence, and export. Describe only shipped behavior.
6. **Try it.** Put the hosted-app link first and give a three- or four-step first success path. A small Mermaid sample is worthwhile only if it lets a visitor reproduce the illustrated result quickly.
7. **Project status and direction.** Separate `Today` from `Direction`. State maturity, browser/local-data expectations, known scope limits, and the intended future product in plain language. Link evolving detail to issues or domain documentation instead of embedding a brittle backlog.
8. **Develop locally.** List prerequisites and copyable install/dev/verify commands. Explain any non-obvious browser installation step. Keep architecture details behind links to maintained docs.
9. **Documentation, support, and contributions.** Route user help and bugs to the issue tracker, link contributor/domain/schema documentation, and say explicitly whether outside contributions are welcome and how proposals should start.
10. **License.** Link the repository license and name it; if no license exists, do not imply that the project is open source merely because its source is public.

GitHub already generates an outline from headings, so a hand-maintained table of contents is optional and probably unnecessary at Manatee's likely README length. Use relative links for repository files and absolute links for the deployed editor. [GitHub: generated outlines and relative links](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes#auto-generated-table-of-contents-for-markdown-files)

## Writing and maintenance checks

- Lead sections with outcomes and user language; move framework and module names to development/architecture material.
- Distinguish current capability, known limitation, and aspiration with unmistakable labels. Do not let roadmap prose read as shipped behavior.
- Verify every command from a clean checkout and every feature statement against the current application or tests.
- Prefer one current visual over a gallery that will become stale. Give it useful alt text and keep the live app usable without requiring the image.
- Keep headings descriptive and shallow. Short paragraphs, compact lists, and copyable code blocks should make the page skimmable without turning it into a badge wall.
- Review the README whenever user-visible capability, prerequisites, deployment URL, support policy, maturity, or contribution expectations change.
