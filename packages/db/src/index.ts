export { createDatabase, ping } from './client.js'
export type { DatabasePing } from './client.js'
export { migrate, migrationsDirectory } from './migrate.js'
export { defaultDatabasePath } from './paths.js'
export {
  createCreatorProfile,
  getCreatorProfile,
  updateCreatorProfile,
  deleteCreatorProfile,
  listCreatorProfiles,
} from './profiles.js'
export type {
  CreatorProfile,
  NewCreatorProfile,
  CreatorProfileUpdates,
  CreatorProfileFilter,
  CreatorProfileList,
} from './profiles.js'
export {
  MEMORY_CATEGORIES,
  addCreatorMemory,
  listCreatorMemories,
  getCreatorMemory,
  updateCreatorMemory,
  deleteCreatorMemory,
  searchCreatorMemories,
} from './memories.js'
export type {
  MemoryCategory,
  CreatorMemory,
  NewCreatorMemory,
  CreatorMemoryUpdates,
  CreatorMemoryFilter,
  MemorySearchList,
  MemorySearchOptions,
} from './memories.js'
export { findCompatibleCreators } from './matching.js'
export type { CreatorMatch, CreatorMatchList, CreatorMatchOptions } from './matching.js'
export {
  COLLABORATION_STATUSES,
  createCollaboration,
  getCollaboration,
  listCollaborationsForCreator,
  updateCollaborationStatus,
  updateCollaborationProposal,
  submitCounterProposal,
  isValidCollaborationStatusTransition,
} from './collaborations.js'
export {
  createCollaborationProposal,
  getCollaborationProposal,
  listCollaborationProposals,
  appendCollaborationProposal,
} from './collaboration_proposals.js'
export type {
  CollaborationProposal,
  NewCollaborationProposal,
} from './collaboration_proposals.js'
export type {
  Collaboration,
  CollaborationStatus,
  NewCollaboration,
  CollaborationUpdates,
  CollaborationFilter,
  CollaborationList,
  CollabEscrow,
  CollabSubmission,
} from './collaborations.js'
export {
  getCollabEscrow,
  lockCollabEscrow,
  submitCollabDeliverable,
  flagCollabDispute,
  listCollabSubmissions,
} from './collaborations.js'
export {
  FOLLOW_UP_STATUSES,
  createFollowUp,
  scheduleFollowUp,
  getFollowUp,
  listFollowUpsForCollaboration,
  listDueFollowUps,
  updateFollowUpStatus,
  incrementFollowUpAttempts,
  isValidFollowUpStatusTransition,
} from './follow_ups.js'
export type {
  FollowUp,
  FollowUpStatus,
  NewFollowUp,
  FollowUpFilter,
  FollowUpList,
} from './follow_ups.js'
export {
  recordCollaborationOutcome,
  collaborationOutcomeMemoryId,
  collaborationOutcomeContent,
} from './outcomes.js'
export {
  recordGrowthOutcome,
  listGrowthOutcomesForCollaboration,
  growthSummaryForCreator,
  growthOutcomeMemoryId,
  growthOutcomeContent,
} from './growth.js'
export type { GrowthOutcome, NewGrowthOutcome, GrowthDelta } from './growth.js'
export { buildMindContext, stubMindAdapter } from './mind.js'
export type { MindContext, MindAdapter, MindMemorySearch, MindContextOptions } from './mind.js'
export {
  AUDIENCE_BUCKETS,
  COLLAB_TYPES,
  AVAILABILITY_BUCKETS,
  getProfileDetails,
  setProfileDetails,
  profileDetailsCompleteness,
  totalDetailFields,
} from './profile_details.js'
export type {
  ProfileDetails,
  ProfileDetailsUpdates,
  AudienceBucket,
  CollabType,
  AvailabilityBucket,
} from './profile_details.js'
export {
  setOpenCollab,
  getOpenCollab,
  listOpenCollabs,
  evaluateThreshold,
  findThresholdMatches,
  listBrandOpenCreators,
} from './open_collabs.js'
export type { OpenCollab, NewOpenCollab, ThresholdMatch, BrandFilterCriteria } from './open_collabs.js'
export {
  registerAccount,
  loginWithPin,
  resolveSession,
  logoutSession,
  getAccountProfile,
  SESSION_TTL_MS,
} from './auth.js'
export type { AuthAccount, AuthSession } from './auth.js'
export {
  MIND_INTERACTION_ROLES,
  createMindInteraction,
  getMindInteraction,
  listMindInteractions,
  deleteMindInteraction,
} from './mind_interactions.js'
export type {
  MindInteraction,
  MindInteractionRole,
  NewMindInteraction,
  MindInteractionFilter,
  MindInteractionList,
} from './mind_interactions.js'
export { seedDemoAccounts, DEMO_CREATORS } from './seed.js'
export type { DemoCreatorSeed } from './seed.js'
export {
  registerBrandAccount,
  loginBrand,
  resolveBrandSession,
  logoutBrandSession,
  getBrandAccount,
  updateBrandMind,
  seedBrandMindProfile,
  BRAND_MEMORY_PREFIXES,
  BRAND_SESSION_TTL_MS,
} from './brand_auth.js'
export type { BrandAccount, BrandSession, RegisterBrandInput, BrandMindSeedInput } from './brand_auth.js'
