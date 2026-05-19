# Domain Routing Rule v1.0

本規則定義平台如何將 run 路由到 feature-specific rules。

## 核心原則

平台本身不知道每個 Galaxy 功能要怎麼測。

平台只負責把 run 路由到正確的 domain skill 或 domain reference bundle。

## Routing Inputs

依以下優先順序判斷：

1. explicit `domain` field，例如 `BI`。
2. `featureMain`，例如 `BI工具`。
3. `featureSub`，例如 `自訂報表`。
4. Testcase workbook metadata。
5. Startup instruction markdown。

如果 routing ambiguous，emit `ambiguity_decision` through Tool Bridge。

## 目前 MVP：BI

`domain=BI` 時，暫時不要搬移或重寫既有 BI files。

使用既有 BI sources：

```text
/Users/tommy/Downloads/codex_galaxy/AGENTS.md
/Users/tommy/Downloads/codex_galaxy/BI_TEST_RULES/
/Users/tommy/Downloads/codex_galaxy/BI_DATA/
uploaded testcase xlsx
uploaded testcase md files
```

既有 BI `AGENTS.md` 雖然位於 repo root，目前應視為 domain-level instruction source。

Layer 1 必須把它當 BI-specific，不可當 platform-general。

## 未來 Layout

未來 domains 應逐步走向：

```text
domains/
  BI/
    AGENTS.md
    rules/
    references/
  Member/
    AGENTS.md
    rules/
    references/
```

但 M1 不要求完成這個 migration。

## Rules 與 References 的差異

Domain `AGENTS.md`：

- 說明該 feature 怎麼測。
- 告訴 Codex 何時讀哪些 rules。

Domain `rules/`：

- hard domain-specific behavior。
- test judgement rules。
- UI operation rules。
- result formatting rules。

Domain `references/`：

- source material。
- metadata。
- PRD excerpts。
- historical bugs。
- data dictionaries。

References 只在需要時讀。

## Missing Domain

如果無法安全選定 domain：

1. 不要猜。
2. emit `ambiguity_decision`。
3. 說明目前可用欄位。
4. 請 Tommy 選擇或補 domain。

## Cross-Domain Rule

除非 run 明確要求用 BI 作為 comparison reference，否則不可把 BI-specific rules 套到非 BI domain。

## Platform / Domain Boundary

Routing selects which domain pack supplies feature semantics. It must not convert domain semantics into platform behavior.

Use `rules/platform-domain-boundary.md` when deciding where a new rule, helper behavior, evidence requirement, or judgment policy belongs.

Minimum rules:

1. Platform routing can know that a domain pack exists, but not how that feature's UI works.
2. Domain pack data owns UI object ids, aliases, locator hints, semantic maps, action templates, evidence schemas, lint rules, and known product gaps.
3. Testcase packages own per-case purpose, values, expected outcomes, risk level, and test target.
4. Runtime branches containing concrete BI case ids, project names, source report labels, or single-feature UI phrases are temporary bridge candidates, not permanent routing behavior.
5. If a future feature needs the same structural capability as BI, create the equivalent domain-pack artifact for that feature instead of adding another platform branch.
