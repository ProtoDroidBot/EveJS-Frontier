# Client runtime patch resilience

For code injected into the client, put `try` blocks inside patched functions and custom client functions at the smallest independent operation. A failed optional service call, row, command, or visual update should leave the rest of the function or menu usable.

Keep the original client path available when an optional adapter step fails. Continue other menu entries and list items after one item fails. Keep server authority checks and failed mutations explicit: do not turn a denied command into a reported success. When a failure affects a visible action, show a useful status where the UI supports it. For changes with meaningful failure risk, test that one failed operation leaves another usable.
