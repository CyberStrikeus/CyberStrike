import type { QuestionInput } from "./types"

// v1 answers contain labels; keep option values identical so replies round-trip without an index lookup.
export function projectForm(request: QuestionInput) {
  return {
    id: request.id.replace(/^que_/, "frm_"),
    sessionID: request.sessionID,
    title: request.questions[0]?.header ?? "",
    fields: request.questions.map((question, index) => ({
      key: `question-${index}`,
      type: question.multiple ? "multiselect" : "string",
      title: question.question,
      options: question.options.map((option) => ({
        value: option.label,
        label: option.label,
      })),
    })),
  }
}
