export {
  localToWorld,
  reanchorRotatedResize,
  resizeAnchorFractions,
  rotateShapeAround,
  shapeCenter,
  groupResizeMember,
  mapShapeThroughHostResize,
  mapShapeThroughLocalMap,
  rotatedAabb,
  unrotatedSizeMatchingAabb,
} from '../src/core/transform';
export { downsamplePolyline, toLocalPoints, toWorldPoints } from '../src/core/pointsSpace';
export {
  beginWriteGesture,
  configureWriteGate,
  closeWriteGate,
  endWriteGesture,
  enqueuePatches,
  flushNow,
  resetWriteGate,
} from '../src/core/writeGate';
export {
  aimPeerMotion,
  initPeerMotion,
  peerMotionShouldAnimate,
  peerSampleGapSec,
  pushPeerSample,
  sampleDeltaSec,
  smoothDamp,
  snapPeerMotionToSample,
  applyRealtimePeerPose,
  stepPeerMotion,
  PEER_MOTION_HOLD_SEC,
  PEER_MOTION_REALTIME_HOLD_SEC,
  PEER_MOTION_RESUME_GAP_SEC,
  PEER_MOTION_STALE_SEC,
  REALTIME_LEAD_SEC,
} from '../src/core/peerMotion';
export {
  boardHadRemoteCollaborators,
  compactBlockedByRecentPeer,
  compactSavesEnough,
  hasOtherLocalReplicas,
  lastRemotePeerAt,
  markBoardHadRemote,
  noteDistinctRemote,
  noteRemotePeer,
  parseReplicaMap,
  pruneReplicaMap,
  replicaMapHasOther,
  remotePeerRecentlySeen,
  replicaTabId,
  touchReplica,
  releaseReplica,
  REPLICA_TTL_MS,
} from '../src/core/compactGuard';
export { wrapLinesByWidth, estimateTextWidth } from '../src/core/textLayout';
export { wrapRichLines } from '../src/core/richText';
export { shapesFromClipboardText } from '../src/core/clipboardShapes';
