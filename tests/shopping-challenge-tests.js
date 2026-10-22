'use strict';
const assert = require('assert');
const Shopping = require('../js/shopping-challenge');

let checks = 0;
function ok(value, message) { assert(value, message); checks++; }
function challenge() { return Shopping.create(); }

ok(Shopping.CATALOGUE.length >= 100, 'catalogue contains at least 100 products');
ok(new Set(Shopping.CATALOGUE.map(item => item.key)).size === Shopping.CATALOGUE.length, 'all product IDs are unique');
for (const [category, count] of [['ingredients',30],['equipment',20],['absurd',35],['maths',15]]) {
  ok(Shopping.CATALOGUE.filter(item => item.category === category).length >= count, category + ' minimum count is correct');
}
Shopping.CATALOGUE.forEach(item => {
  ok(item.key && item.name && item.price && item.description && item.review, item.key + ' has complete product data');
});

for (const recipe of Shopping.RECIPES) {
  const c = Shopping.create(null, recipe.name);
  ok(c.recipe === recipe.name, recipe.name + ' can be generated');
  recipe.items.forEach(([key]) => ok(c.products.some(product => product.key === key), recipe.name + ' base item is in catalogue'));
  c.required.forEach(item => {
    ok(c.products.some(product => product.key === item.key), recipe.name + ' required item is searchable');
    Shopping.add(c, item.key, item.quantity, item.math ? item.math.answer : undefined);
  });
  ok(Shopping.complete(c, c.credentials).ok, recipe.name + ' can be checked out');
}

let varied = new Set();
let previous = null;
for (let i = 0; i < 80; i++) {
  const c = Shopping.create(previous);
  ok(c.recipe !== previous, 'recipe selection avoids immediate repeats');
  previous = c.recipe;
  varied.add(c.recipe);
}
ok(varied.size >= 10, 'repeated challenges genuinely vary recipes');

for (let i = 0; i < 25; i++) {
  const c = challenge();
  ok(c.token.length >= 40, 'challenge has a capability token');
  ok(c.required.length >= 7 && c.required.length <= 8, 'recipe has normal and absurd requirements');
  c.required.forEach(item => ok(c.products.some(product => product.key === item.key), 'required product is searchable'));
  const absurd = c.required.filter(item => item.absurd);
  ok(absurd.length >= 1 && absurd.length <= 2, 'one or two absurd products are assigned');
  const maths = absurd.filter(item => item.math);
  maths.forEach(item => {
    const wrong = Shopping.add(c, item.key, 1, 'definitely-not-the-answer');
    ok(!wrong.ok && wrong.mathRequired, 'wrong maths answer is rejected without resetting');
    const right = Shopping.add(c, item.key, 1, item.math.answer);
    ok(right.ok, 'correct maths answer unlocks the product');
  });
  c.required.filter(item => !item.math).forEach(item => Shopping.add(c, item.key, item.quantity));
  const missing = c.required.find(item => (c.basket[item.key] || 0) < item.quantity);
  if (missing) {
    const result = Shopping.complete(c, c.credentials);
    ok(!result.ok && /missing/i.test(result.message), 'incomplete basket cannot checkout');
    Shopping.add(c, missing.key, missing.quantity);
  }
  const declined = Shopping.complete(c, { email:'bad', accountId:'bad', securityCode:'bad' });
  ok(!declined.ok && /declined/i.test(declined.message), 'bad credentials are declined');
  ok(Shopping.complete(c, c.credentials).ok, 'valid credentials complete the basket');
  ok(c.status === 'complete', 'completed challenge is permanently settled');
  ok(!Shopping.add(c, c.required[0].key, 1).ok, 'settled challenge cannot be changed');
}

const expired = challenge();
expired.expiresAt = Date.now() - 1;
ok(Shopping.expired(expired), 'expired challenge is detected');
ok(!Shopping.add(expired, expired.required[0].key, 1).ok, 'expired challenge cannot accept items');

console.log(checks + ' shopping challenge checks passed');
