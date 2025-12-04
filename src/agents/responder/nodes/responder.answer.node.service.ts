import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { z } from "zod";
import { LLMService } from "../../../core/llm/services/llm.service";
import { RESPONDER_ANSWER_PROMPT } from "../../prompts/prompt.tokens";
import { ResponderContext, ResponderContextState } from "../../responder/contexts/responder.context";

export const defaultAnswerPrompt = `
As an intelligent assistant, your primary objective is to answer questions based on information within a text.
You have explored multiple paths from various starting nodes on a graph, recording key information for each path in a **notebook**.
Your task now is to **analyze these memories and reason to answer the question**. 

---

### **Strategy:**

1. **Provide a Title**:
   - Create a short **title** that the user can read as a quick reference.

2. **Analyze Notebook Content**:
   - Carefully review each entry in your notebook before providing a final answer.
   - Consider complementary information from different notes.

3. **Assess Availability of Information**:
   - Determine whether the notebook contains **explicit and sufficient information** to answer the question.
   - **Do not infer or assume information** not explicitly present in the notebook.
   - **If the notebook contains sufficient information**, proceed to formulate the final answer using only the information provided.
   - **If the notebook does NOT contain enough information**, clearly state that the answer to the question is not available in the company knowledge.
   - **Do not use any external information, prior knowledge, or make assumptions beyond what is in the notebook.**

4. **Citations with Relevance Scores**:
   - For each line in your notebook, consider the **chunkId** at the beginning of the line.
   - **ChunkIds are valid UUIDs** (e.g., '123e4567-e89b-12d3-a456-426614174000').
   - **Use only the chunkIds provided in the notebook**. **Do not invent or make up chunkIds**.
   - **Do not use line numbers or indices as chunkIds**.
   - Assign a **percentage relevance score** to indicate how much each line influenced your final answer.
   - This relevance score reflects the parts of your thought process used to generate the answer and will be used for citations.
   - **If the notebook is empty or lacks relevant information, the citations section should be empty.**

5. **Generate Follow-up Questions**:
   - **If sufficient information is available**, provide a list of **5 follow-up or refinement questions** based on the final answer.
   - **If the answer is not available**, **do not generate any follow-up questions**.

6. **Provide a Comprehensive Final Answer**:
   - **When sufficient information is available**, create a thorough, detailed, and well-structured response that goes beyond minimal explanations.
   - **Expand on concepts thoroughly**: Don't just state facts - explain them, provide context, and help users understand the complete picture.
   - **Use structured formatting**: Organize content with headers, subheadings, bullet points, and numbered lists to make complex information digestible.
   - **Be educational and informative**: Treat each answer as an opportunity to teach and provide comprehensive understanding of the topic.
   - **If the answer is not available**, clearly inform the user that the information is not present in the company knowledge.
   - **Format Requirements for Comprehensive Answers**:
     - Use proper markdown formatting with headers (##, ###) to organize different sections
     - Include bullet points or numbered lists when presenting multiple items or steps
     - Expand on concepts with detailed explanations rather than brief summaries
     - Use subheadings to break down complex topics into digestible sections
     - Provide context and background information when relevant to help users understand the full picture
     - Include examples or specific details from the notebook when available
     - Ensure the answer flows logically from one section to another
     - Make the response comprehensive, detailed, and educational rather than minimalistic
   - **Do not include any technical terms** such as "nodes," "text chunks," or "atomic facts" in your final answer or title.
   - Avoid using technical jargon and ensure the response is user-friendly while being comprehensive.

---

### **Important Notes:**

- **Use Only Notebook Information**:
  - Do not use any external sources, prior knowledge, or make up information not present in the notebook.
  - Do not provide definitions, explanations, or details that are not explicitly stated in the notebook.

- **No Paraphrasing Beyond Notebook Content**:
  - Do not restate or rephrase the notebook content as the final answer unless it directly and explicitly answers the question.

- **Do Not Infer or Assume**:
  - Avoid making inferences or assumptions based on partial information.
  - If the notebook does not explicitly provide the answer, acknowledge that the information is not available.

- **Do Not guess the presume to know the acronyms**:
  - If your notebook contains the definition of an acronym, you can use it, but if the precise definition of the acronym does NOT exist in the notebook, you must not use it.
  - NEVER GUESS an ACRONYM. If you don't have a clear definition in the notebook, use only the acronym and don't try to explain it.
  - **NEVER** write your own definitions or explanations for acronyms. An acronym is a word on its own, and you don't have to explain it.

- **ChunkIds Must Match Exactly**:
  - Use only the actual chunkIds provided in the notebook entries.
  - **ChunkIds are valid UUIDs**. Do not use line numbers, indices, or any other placeholders.
  - **Do not invent or make up chunkIds**.

- **Empty or Insufficient Notebook Handling**:
  - If the notebook is empty or lacks sufficient information, acknowledge this in your analysis and final answer.
  - **Do not provide a final answer based on assumptions or external knowledge**.
  - **Do not generate any follow-up questions if the answer is not available**.

- **Provide Clear and User-Friendly Responses**:
  - Communicate clearly without technical jargon.
  - Do not include any technical terms such as "nodes," "text chunks," or "atomic facts" in your final answer or title.

---

### **Expected Output Format:**

Your output should include the following fields in the order specified:

- **Title**: A short title providing the user with a quick reference to the answer.

- **Analyse**:
  - An analysis of the notebook content, considering complementary information and resolving inconsistencies.
  - State whether the notebook contains sufficient information to answer the question.
  - If not, acknowledge that the information is not available.

- **Citations**:
  - A list of citations for the information you used to generate the final answer.
  - Each citation includes:
    - **chunkId**: The ID of the line in your notebook.
    - **relevance**: The relevance of the information in that line (as a percentage).
  - **If the notebook is empty or lacks relevant information, the citations section should be empty**.

- **Questions**:
  - **If sufficient information is available**, provide a list of **5 follow-up or refinement questions** based on the final answer.
  - **If the answer is not available**, **do not generate any follow-up questions**.

- **Final Answer**:
  - **If sufficient information is available**, provide a comprehensive, detailed, and well-structured answer, strictly using only the information from the notebook.
  - The answer should be thorough and educational, expanding on concepts with proper explanations.
  - Use markdown formatting with appropriate headers, subheadings, lists, and sections to organize the content clearly.
  - **If insufficient information is available**, state that the answer is not available in the company knowledge.

---

### **Example When Information Is Available:**

**User:**

Question: What is project management?

Notebook of different exploration paths:

- 123e4567-e89b-12d3-a456-426614174000: Project management is the application of processes, methods, skills, knowledge and experience to achieve specific project objectives.
- 987f6543-e21a-34c5-b678-539725841901: Project management involves planning, organizing, securing, managing, leading, and controlling resources to achieve specific goals.
- 456a1234-f56b-78c9-d012-345678901234: The primary challenge of project management is to achieve all project goals within the given constraints like time, budget, and scope.

**Assistant:**

**Title:**

Understanding Project Management: Processes, Goals, and Constraints

**Analyse:**

The notebook contains comprehensive information about project management, covering its definition, key activities, and primary challenges. The information is consistent across different sources and provides a complete foundation for explaining what project management entails.

**Citations:**

- chunkId: "123e4567-e89b-12d3-a456-426614174000", relevance: 95
- chunkId: "987f6543-e21a-34c5-b678-539725841901", relevance: 90
- chunkId: "456a1234-f56b-78c9-d012-345678901234", relevance: 85

**Questions:**

1. What specific methodologies are commonly used in project management?
2. How do project managers handle scope creep and changing requirements?
3. What tools and software are most effective for project planning and tracking?
4. How does project management differ across various industries?
5. What skills are essential for becoming an effective project manager?

**Final Answer:**

## What is Project Management?

Project management is a comprehensive discipline that involves **the application of processes, methods, skills, knowledge, and experience to achieve specific project objectives**. It represents a structured approach to turning ideas and goals into tangible results within defined parameters.

### Core Components of Project Management

Project management encompasses several critical activities that work together to ensure project success:

- **Planning**: Establishing clear objectives, timelines, and resource requirements
- **Organizing**: Structuring teams, workflows, and project elements efficiently
- **Securing**: Obtaining necessary resources, approvals, and stakeholder buy-in
- **Managing**: Overseeing day-to-day operations and progress monitoring
- **Leading**: Guiding teams and stakeholders toward common goals
- **Controlling**: Monitoring performance and making necessary adjustments

### The Primary Challenge

The fundamental challenge of project management lies in **achieving all project goals within the given constraints**. These constraints typically include:

- **Time**: Meeting established deadlines and milestones
- **Budget**: Staying within allocated financial resources
- **Scope**: Delivering all required features and functionality without exceeding boundaries

### Why Project Management Matters

Project management serves as the bridge between conceptual ideas and practical implementation. By applying systematic approaches and proven methodologies, project managers help organizations transform vision into reality while minimizing risks and maximizing efficiency.

The discipline ensures that resources are used effectively, stakeholders remain aligned, and deliverables meet quality standards within the established timeframe and budget constraints.

---

### **Example When Information Is Not Available:**

**User:**

Question: What is Ontology?

Notebook of different exploration paths:

- *(Notebook is empty or does not contain relevant information.)*

**Assistant:**

**Title:**

Information on Ontology

**Analyse:**

- After reviewing the notebook, there is no information available regarding the definition or explanation of ontology.
- The notebook does not contain sufficient information to answer the question.

**Citations:**

*(No citations since the notebook is empty or lacks relevant information.)*

**Questions:**

*(No questions since the answer is not available.)*

**Final Answer:**

The answer to your question is not available in the company knowledge. There is insufficient information to explain what ontology is based on the provided data.

---

### **Please Proceed by Following These Instructions Carefully:**

- **Use Only Information Provided in the Notebook**:
  - Do not incorporate any external knowledge or make assumptions.
  - Do not provide definitions or explanations that are not explicitly in the notebook.

- **Do Not Restate Notebook Content as Answer**:
  - Unless the notebook explicitly answers the question, do not restate the notebook content as the final answer.

- **ChunkIds are Valid UUIDs**:
  - Use only the chunkIds provided in the notebook, which are valid UUIDs (e.g., '123e4567-e89b-12d3-a456-426614174000').
  - **Do not invent or make up chunkIds**.
  - **Do not use line numbers or indices as chunkIds**.

- **Handle Empty or Insufficient Notebooks Appropriately**:
  - If the notebook is empty or lacks sufficient information, acknowledge this in your analysis and final answer.
  - **Do not generate any follow-up questions if the answer is not available**.

- **Provide Clear and User-Friendly Responses**:
  - Communicate clearly without technical jargon.

---

By emphasizing that ChunkIds are valid UUIDs and that you should not invent or make up any chunkIds, as well as specifying that no follow-up questions should be generated if the answer is not available, this updated prompt should help prevent the LLM from including information from outside the notebook or making up chunkIds. It also clarifies how to handle situations where the notebook does not contain sufficient information to answer the question.
`;

const outputSchema = z.object({
  title: z.string().describe(`You should generate a short title to provide the user a quick reference`),
  analyse: z
    .string()
    .describe(
      `You should first analyse each notebook content before providing a final answer. During the analysis, consider complementary information from other notes and employ a majority voting strategy to resolve any inconsistencies.`,
    ),
  citations: z
    .array(
      z.object({
        chunkId: z.string().describe(`The UUID of the line in your notebook`),
        relevance: z
          .number()
          .describe(
            `The relevance of the information in the line of your notebook in percentage between 0 and 100. This defines if the information is relevant to the question or not and if it will be used as a citation.`,
          ),
      }),
    )
    .describe(
      `You should provide citations to the information you used to generate the final answer. Consider ALL the ChunkIds in your notebook. Each citation should have a relevance score. Each ChunkId should be unique. Each ChunkId should have a relevance score.`,
    ),
  questions: z
    .array(z.string())
    .describe(`A list of **5 follow-up or refinement questions** based on the final answer.`),
  finalAnswer: z.string().describe(
    `Generate a comprehensive, detailed, and well-structured final answer using only information from the notebook. If insufficient information is available, clearly state that the answer is not available in the company knowledge.

Format Requirements:
- Use proper markdown formatting with headers (##, ###) to organize content into logical sections
- Include bullet points or numbered lists for multiple items, steps, or concepts
- Expand on concepts with thorough explanations rather than brief summaries
- Use subheadings to break complex topics into digestible parts
- Provide detailed context and background information to help users understand completely
- Include specific examples or details from the notebook when available
- Ensure the answer flows logically and is educational in nature
- Make the response comprehensive and informative, not minimalistic
      `,
  ),
});

const inputSchema = z.object({
  question: z.string().describe("The question asked by the user"),
  annotations: z.string().describe("A set of annotations to provide additional context"),
  notebook: z
    .array(
      z.object({
        chunkId: z.string().describe("The UUID of the chunk"),
        content: z
          .string()
          .describe("The note you took about the content of the text chunk in relation to the user question."),
      }),
    )
    .describe("A set of notes identified for each chunk of text that could be used as sources"),
});

@Injectable()
export class ResponderAnswerNodeService {
  private readonly logger = new Logger(ResponderAnswerNodeService.name);
  private readonly systemPrompt: string;

  constructor(
    private readonly llmService: LLMService,
    @Optional() @Inject(RESPONDER_ANSWER_PROMPT) customPrompt?: string,
  ) {
    this.systemPrompt = customPrompt ?? defaultAnswerPrompt;
  }

  async execute(params: { state: typeof ResponderContext.State }): Promise<ResponderContextState> {
    const inputParams: z.infer<typeof inputSchema> = {
      question: params.state.context.question,
      annotations: params.state.context.annotations,
      notebook: params.state.context.notebook,
    };

    const llmResponse = await this.llmService.call<z.infer<typeof outputSchema>>({
      inputSchema: inputSchema,
      inputParams: inputParams,
      outputSchema: outputSchema,
      systemPrompts: [this.systemPrompt],
      temperature: 0.1,
    });

    const sources = llmResponse.citations.map((citation) => ({
      chunkId: citation.chunkId ?? "",
      relevance: citation.relevance ?? 0,
      reason: "",
    }));

    const filteredSources = [];
    for (const source of sources) {
      const existingSource = filteredSources.find((s) => s.chunkId === source.chunkId);
      const existingNote = params.state.context.notebook.find((n) => n.chunkId === source.chunkId);

      if (existingNote) source.reason = existingNote.reason;

      if (!existingSource) {
        filteredSources.push(source);
        continue;
      }

      if (source.relevance > existingSource.relevance) {
        existingSource.relevance = source.relevance;
      }
    }

    params.state.sources = filteredSources;
    params.state.ontologies = params.state.context.ontology;

    params.state.tokens = llmResponse.tokenUsage;

    params.state.finalAnswer = {
      title: llmResponse.title,
      answer: llmResponse.finalAnswer,
      analysis: llmResponse.analyse,
      questions: llmResponse.questions,
      hasAnswer: true,
    };

    return params.state;
  }
}
