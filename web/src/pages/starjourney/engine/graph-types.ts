// Star-map graph shape — the JSON returned by `/api/learning/graph`.
//
// Dashboard-local copy of the desktop engine's graph shape. Keep optional
// provider fields backward-compatible: the view does not install a new backend.

/** One graph node in the star map (learned skill or memory chunk). */
export interface StarmapNode {
  id: string
  label: string
  kind: 'memory' | 'skill'
  /** 'memory' (MEMORY.md) | 'profile' (USER.md) | a memory-provider name
   *  ('honcho', …) for nodes contributed by an external provider's
   *  journey_cards(). Provider nodes are read-only in the journey. */
  memorySource?: string
  /** Honcho conclusion taxonomy for provider memory nodes: 'explicit' (a
   *  directly-stated fact — a true memory), 'inductive' / 'deductive' (a
   *  derived inference — a conclusion). Absent for file memories, skills, and
   *  older backends that don't emit it — treated as a plain memory. This is
   *  the signal that separates true memories from conclusions in the map. */
  memoryLevel?: string
  /** Where the knowledge originally came from: 'hermes' (born in a Hermes
   *  conversation / file memory / skill) or an import source ('chatgpt', …).
   *  Backend stamps provider nodes; absent (older backend) means 'hermes'. */
  origin?: string
  timestamp?: null | number
  category: string
  useCount: number
  state: string
  createdBy: null | string
  pinned: boolean
  /** Provider-side session this entry was derived from (e.g. a Honcho
   *  conclusion's session). For Hermes-born sessions this doubles as the
   *  Hermes session id; for imported history it only resolves in the
   *  provider backend. Absent on skills and file-based memory chunks. */
  sessionId?: string
}

/** A declared `related_skills` link; both endpoints are guaranteed to be nodes. */
export interface StarmapEdge {
  source: string
  target: string
}

export interface StarmapCluster {
  category: string
  count: number
}

/** Freeform memory rendered as a card — never a graph node. */
export interface StarmapMemoryCard {
  /** 'memory' | 'profile' | a memory-provider name (see StarmapNode.memorySource). */
  source: string
  timestamp?: null | number
  title: string
  body: string
  /** Digest of the card's text, stored in its node id (``memory:<source>:<index>:<fp>``).
   *  Absent on provider cards and on an imported or pre-fingerprint graph. */
  fingerprint?: string
}

export interface StarmapGraph {
  nodes: StarmapNode[]
  edges: StarmapEdge[]
  clusters: StarmapCluster[]
  memory: StarmapMemoryCard[]
  stats: Record<string, unknown>
  /** Active external memory provider ('honcho', …) or null/absent (file-based
   *  memory only). Gates provider-specific journey UI — notably the conclusion
   *  node kind, which is only meaningful when Honcho is the active provider.
   *  Absent from an un-upgraded backend, so treat missing as null. */
  memoryProvider?: null | string
}
