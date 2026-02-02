export type RetrievalQueryRole = "precision" | "recall"

export type RetrievalQuery = {
  role: RetrievalQueryRole
  q: string
  lang: string
  kind: string
}

export type RetrievalPlanForKey = {
  specVersion: string
  intent: {
    normalized: string
  }
  queries: RetrievalQuery[]
  filters: {
    paths: string[]
    symbols: string[]
    kinds: string[]
  }
  budget: {
    maxHits: number
    topK: number
    maxWallClockMs: number
  }
  sources: string[]
  versions: {
    rules: string
    stableJson: string
  }
}
