// Prompt configuration is now via baseConfig.prompts (see ConfigPromptsInterface)
// This file exports the default prompts for reference

// Default prompts - re-exported from services for reference
export { defaultGraphCreatorPrompt } from "../graph.creator/services/graph.creator.service";
// Also exported under its bare in-service name, mirroring the responder pair below.
export { prompt as graphCreatorPrompt } from "../graph.creator/services/graph.creator.service";
export { defaultAnswerPrompt as defaultResponderAnswerPrompt } from "../responder/nodes/responder.answer.node.service";
// Also exported under its own name — app-side prompt overrides reference it directly.
export { defaultAnswerPrompt } from "../responder/nodes/responder.answer.node.service";

// Contextualiser default prompts
export { defaultQuestionRefinerPrompt } from "../contextualiser/nodes/question.refiner.node.service";
export { defaultRationalPlanPrompt } from "../contextualiser/nodes/rational.node.service";
export { defaultKeyConceptsPrompt } from "../contextualiser/nodes/keyconcepts.node.service";
export { defaultAtomicFactsPrompt } from "../contextualiser/nodes/atomicfacts.node.service";
export { defaultChunkPrompt } from "../contextualiser/nodes/chunk.node.service";
export { defaultChunkVectorPrompt } from "../contextualiser/nodes/chunk.vector.node.service";

// Summariser default prompts
export { defaultMapPrompt, defaultCombinePrompt, defaultTldrPrompt } from "../summariser/services/summariser.service";
