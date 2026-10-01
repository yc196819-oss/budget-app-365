// Compact lesson builder, so the content files read like a book.
// quiz items: [question, [options], index of the right answer, why]
export function L(id, title, body, takeaway, quiz) {
  return { id, title, body, takeaway, quiz: quiz.map(([q, options, answer, why]) => ({ q, options, answer, why })) };
}
