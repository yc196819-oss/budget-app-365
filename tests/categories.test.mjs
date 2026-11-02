import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCategoryName } from '../public/app/src/domain/categories.js';

const cats = [
  { id: 'food', name: 'אוכל', kind: 'expense' },
  { id: 'sal', name: 'משכורת', kind: 'income' },
  { id: 'kids', name: 'ילדים', kind: 'expense' },
  { id: 'clubs', name: 'חוגים', kind: 'expense', parent_id: 'kids' }
];

test('a new category name: trimmed, at least 2 letters, at most 40', () => {
  assert.deepEqual(checkCategoryName('  חיות   מחמד ', { categories: cats }), { name: 'חיות מחמד' });
  assert.match(checkCategoryName('א', { categories: cats }).error, /לפחות 2/);
  assert.equal(checkCategoryName('x'.repeat(60), { categories: cats }).name.length, 40);
});

test('no twin in the same place; the same name elsewhere is fine', () => {
  const twin = checkCategoryName('אוכל ', { categories: cats });
  assert.match(twin.error, /כבר יש/);
  assert.equal(twin.existing.id, 'food');
  assert.deepEqual(checkCategoryName('אוכל', { categories: cats, kind: 'income' }), { name: 'אוכל' }, 'income has its own list');
  assert.match(checkCategoryName('חוגים', { categories: cats, parentId: 'kids' }).error, /כבר יש/);
  assert.deepEqual(checkCategoryName('חוגים', { categories: cats }), { name: 'חוגים' }, 'a top level name may match a sub-category');
  assert.deepEqual(checkCategoryName('אוכל', { categories: cats, exceptId: 'food' }), { name: 'אוכל' }, 'renaming to its own name');
});
