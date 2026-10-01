// The learning corner: topics in teaching order, from the basics up.
// Every lesson: a short explanation, one takeaway and a 2-question quiz.
import budget from './t01-budget.js';
import income from './t02-income.js';
import bank from './t03-bank.js';
import credit from './t04-credit.js';
import savings from './t05-savings.js';
import debt from './t06-debt.js';
import interest from './t07-interest.js';
import invest from './t08-invest.js';
import pension from './t09-pension.js';
import insurance from './t10-insurance.js';
import housing from './t11-housing.js';
import consumer from './t12-consumer.js';
import planning from './t13-planning.js';

export const TOPICS = [budget, income, bank, credit, savings, debt, consumer, interest, invest, pension, insurance, housing, planning];

// All lessons in order, each knowing its topic.
export const LESSONS = TOPICS.flatMap((t) => t.lessons.map((l, i) => ({ ...l, topicId: t.id, topicTitle: t.title, icon: t.icon, part: i + 1, parts: t.lessons.length })));
