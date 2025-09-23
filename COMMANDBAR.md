I wrote up a full spec for CRUX and dropped it in the canvas — it’s structured, copy-pasteable, and ready to align on. Highlights:
	•	Grammar (EBNF), operators, filters, views, pipes, macros/aliases
	•	UX flows, keyboard map, errors/hints, preview contracts
	•	Suggest/Evaluate API payloads, acceptance criteria, and concrete test cases
	•	Telemetry, performance budgets, rollout phases, and open questions

unresolved:
	1.	Filter semantics — multiple filters after >: AND by default? Do you want an OR form like role:(engineer|designer)?
	2.	Delta Δ — should it compare against the current window:* in the same statement, or support two explicit windows (e.g., Δ window:Q2025 vs window:Q2024)?
	3.	Scores in UI — okay to surface “ghost counts”/scores inside operator chips, or keep raw scores only in the Explain panel?
	4.	Pipes behavior — should | export:csv be synchronous (trigger download) or queued with a toast/progress? Same question for | save and | share.
	5.	Macro scope — should user-defined macros persist per user, per workspace, or just per-session?