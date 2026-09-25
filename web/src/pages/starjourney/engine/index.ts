// Star-map render core — framework-agnostic canvas + d3-force engine shared by
// every host that draws the journey graph (desktop Electron app, web
// dashboard). No React, no app-specific imports: hosts own the React shell and
// pass in a StarmapGraph; this package owns the pixels.

export {
  computePalette,
  conclusionInkFor,
  darken,
  luminance,
  memoryInkFor,
  mixRgb,
  resolveRgb,
  rgba
} from './color'
export {
  AGE_GRADIENT,
  BLACK,
  FIT_PADDING,
  MODE_DEFAULTS,
  NODE_SHAPE,
  RING_INNER,
  RING_OUTER,
  RING_PARAMS,
  RING_STEPS,
  TILT,
  WHITE,
  ZOOM_MAX,
  ZOOM_MIN
} from './constants'
export type {
  StarmapCluster,
  StarmapEdge,
  StarmapGraph,
  StarmapMemoryCard,
  StarmapNode
} from './graph-types'
export {
  clamp,
  distToSegmentSq,
  fitScale,
  fitViewport,
  hash,
  nodeRadius,
  radiusForRecency,
  recencyInk,
  shapePath
} from './geometry'
export { drawScene, drawScramble, drawSearchPulse, type DrawResult, type Scene } from './render'
export { buildSimulation, type BuiltSim } from './simulation'
export { isProviderSource } from './sources'
export { countLabel, ellipsize, formatDate, metaBadges, nodeFooter, wrapText } from './text'
export {
  buildTimeAxis,
  computeRecency,
  dateAtReveal,
  LEAD_IN,
  recForRatio,
  type Recency,
  type TimeAxis,
  type TimeBucket
} from './time-axis'
export type {
  FadeBuckets,
  GraphParams,
  MemoryCard,
  Palette,
  Rect,
  Rgb,
  Ring,
  RingLabelRect,
  RingParams,
  Shape,
  SimLink,
  SimNode,
  Viewport
} from './types'
