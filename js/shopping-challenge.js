'use strict';

const crypto = require('crypto');

const RECIPES = [
  { name:'Pizza', items:[['plain-flour','Plain flour',2],['tomatoes','Tomatoes',1],['mozzarella-cheese','Mozzarella cheese',2],['olive-oil','Olive oil',1],['baking-tray','Baking tray',1],['cheese-grater','Cheese grater',1]] },
  { name:'Spaghetti Bolognese', items:[['spaghetti','Spaghetti',1],['minced-beef','Minced beef',1],['tomatoes','Tomatoes',2],['onions','Onions',1],['garlic','Garlic',1],['saucepan','Saucepan',1]] },
  { name:'Lasagne', items:[['lasagne-sheets','Lasagne sheets',1],['minced-beef','Minced beef',2],['tomatoes','Tomatoes',1],['mozzarella-cheese','Mozzarella cheese',1],['onions','Onions',1],['baking-tray','Baking tray',1]] },
  { name:'Mac & Cheese', items:[['macaroni','Macaroni',2],['cheddar-cheese','Cheddar cheese',2],['whole-milk','Whole milk',1],['unsalted-butter','Unsalted butter',1],['plain-flour','Plain flour',1],['saucepan','Saucepan',1]] },
  { name:'Chicken Curry', items:[['chicken-breast','Chicken breast',2],['white-rice','White rice',2],['carrots','Carrots',1],['onions','Onions',1],['garlic','Garlic',1],['saucepan','Saucepan',1]] },
  { name:'Fish and Chips', items:[['potatoes','Potatoes',3],['plain-flour','Plain flour',1],['olive-oil','Olive oil',1],['frying-pan','Frying pan',1],['carrots','Carrots',1],['onions','Onions',1]] },
  { name:'Burgers', items:[['minced-beef','Minced beef',2],['bread','Bread rolls',2],['cheddar-cheese','Cheddar cheese',1],['tomatoes','Tomatoes',1],['onions','Onions',1],['frying-pan','Frying pan',1]] },
  { name:'Tacos', items:[['minced-beef','Minced beef',1],['tomatoes','Tomatoes',1],['cheddar-cheese','Cheddar cheese',1],['onions','Onions',1],['frying-pan','Frying pan',1],['mixing-bowl','Mixing bowl',1]] },
  { name:'Stir-Fry', items:[['chicken-breast','Chicken breast',1],['carrots','Carrots',1],['mushrooms','Mushrooms',1],['spring-onions','Spring onions',1],['soy-sauce','Soy sauce',1],['frying-pan','Frying pan',1]] },
  { name:"Shepherd's Pie", items:[['minced-beef','Minced beef',2],['potatoes','Potatoes',3],['carrots','Carrots',1],['onions','Onions',1],['saucepan','Saucepan',1],['baking-tray','Baking tray',1]] },
  { name:'Roast Dinner', items:[['chicken-breast','Chicken breast',2],['potatoes','Potatoes',3],['carrots','Carrots',2],['onions','Onions',1],['baking-tray','Baking tray',1],['oven-gloves','Oven gloves',1]] },
  { name:'Pancakes', items:[['self-raising-flour','Self-raising flour',1],['whole-milk','Whole milk',2],['free-range-eggs','Free-range eggs',1],['caster-sugar','Caster sugar',1],['salted-butter','Salted butter',1],['frying-pan','Frying pan',1]] },
  { name:'Waffles', items:[['plain-flour','Plain flour',1],['free-range-eggs','Free-range eggs',2],['whole-milk','Whole milk',1],['caster-sugar','Caster sugar',1],['unsalted-butter','Unsalted butter',1],['waffle-maker','Waffle maker',1]] },
  { name:'French Toast', items:[['bread','Bread',2],['free-range-eggs','Free-range eggs',2],['whole-milk','Whole milk',1],['caster-sugar','Caster sugar',1],['salted-butter','Salted butter',1],['frying-pan','Frying pan',1]] },
  { name:'Scrambled Eggs', items:[['free-range-eggs','Free-range eggs',3],['whole-milk','Whole milk',1],['salted-butter','Salted butter',1],['cheddar-cheese','Cheddar cheese',1],['frying-pan','Frying pan',1],['wooden-spoon','Wooden spoon',1]] },
  { name:'Full English Breakfast', items:[['free-range-eggs','Free-range eggs',2],['bacon','Bacon',1],['sausages','Sausages',1],['tomatoes','Tomatoes',1],['mushrooms','Mushrooms',1],['frying-pan','Frying pan',1]] },
  { name:'Chocolate Cake', items:[['plain-flour','Plain flour',2],['cocoa-powder','Cocoa powder',1],['free-range-eggs','Free-range eggs',2],['caster-sugar','Caster sugar',1],['unsalted-butter','Unsalted butter',1],['cake-tin','Cake tin',1]] },
  { name:'Brownies', items:[['plain-flour','Plain flour',1],['cocoa-powder','Cocoa powder',2],['free-range-eggs','Free-range eggs',2],['brown-sugar','Brown sugar',1],['unsalted-butter','Unsalted butter',1],['baking-tray','Baking tray',1]] },
  { name:'Cookies', items:[['plain-flour','Plain flour',1],['caster-sugar','Caster sugar',1],['unsalted-butter','Unsalted butter',1],['free-range-eggs','Free-range eggs',1],['baking-powder','Baking powder',1],['baking-tray','Baking tray',1]] },
  { name:'Cheesecake', items:[['cream-cheese','Cream cheese',2],['double-cream','Double cream',1],['icing-sugar','Icing sugar',1],['biscuits','Digestive biscuits',1],['unsalted-butter','Unsalted butter',1],['cake-tin','Cake tin',1]] },
  { name:'Apple Crumble', items:[['plain-flour','Plain flour',1],['brown-sugar','Brown sugar',1],['unsalted-butter','Unsalted butter',1],['cake-tin','Cake tin',1],['double-cream','Double cream',1],['wooden-spoon','Wooden spoon',1]] },
  { name:'Victoria Sponge', items:[['plain-flour','Plain flour',2],['caster-sugar','Caster sugar',1],['free-range-eggs','Free-range eggs',3],['unsalted-butter','Unsalted butter',1],['baking-powder','Baking powder',1],['cake-tin','Cake tin',1]] },
  { name:'Doughnuts', items:[['plain-flour','Plain flour',2],['caster-sugar','Caster sugar',1],['free-range-eggs','Free-range eggs',1],['whole-milk','Whole milk',1],['salted-butter','Salted butter',1],['frying-pan','Frying pan',1]] },
  { name:'Banana Bread', items:[['plain-flour','Plain flour',1],['free-range-eggs','Free-range eggs',1],['brown-sugar','Brown sugar',1],['unsalted-butter','Unsalted butter',1],['cake-tin','Cake tin',1],['wooden-spoon','Wooden spoon',1]] },
  { name:'Grilled Cheese Sandwich', items:[['bread','Bread',2],['cheddar-cheese','Cheddar cheese',2],['salted-butter','Salted butter',1],['frying-pan','Frying pan',1],['spatula','Spatula',1],['cheese-grater','Cheese grater',1]] },
  { name:'Garlic Bread', items:[['plain-flour','Plain flour',1],['garlic','Garlic',2],['olive-oil','Olive oil',1],['unsalted-butter','Unsalted butter',1],['baking-tray','Baking tray',1],['oven-gloves','Oven gloves',1]] },
  { name:'Nachos', items:[['tortilla-chips','Tortilla chips',1],['cheddar-cheese','Cheddar cheese',2],['tomatoes','Tomatoes',1],['onions','Onions',1],['double-cream','Double cream',1],['baking-tray','Baking tray',1]] },
  { name:'Jacket Potato', items:[['potatoes','Potatoes',2],['cheddar-cheese','Cheddar cheese',1],['salted-butter','Salted butter',1],['baking-tray','Baking tray',1],['oven-gloves','Oven gloves',1],['cheese-grater','Cheese grater',1]] },
  { name:'Onion Rings', items:[['onions','Onions',3],['plain-flour','Plain flour',1],['free-range-eggs','Free-range eggs',1],['olive-oil','Olive oil',1],['frying-pan','Frying pan',1],['mixing-bowl','Mixing bowl',1]] },
  { name:'Cheese Omelette', items:[['free-range-eggs','Free-range eggs',3],['cheddar-cheese','Cheddar cheese',1],['mushrooms','Mushrooms',1],['onions','Onions',1],['salted-butter','Salted butter',1],['frying-pan','Frying pan',1]] },
  { name:'Loaded Fries', items:[['potatoes','Potatoes',3],['cheddar-cheese','Cheddar cheese',2],['onions','Onions',1],['tomatoes','Tomatoes',1],['olive-oil','Olive oil',1],['baking-tray','Baking tray',1]] },
  { name:'Ramen', items:[['white-rice','White rice',1],['mushrooms','Mushrooms',1],['free-range-eggs','Free-range eggs',1],['onions','Onions',1],['saucepan','Saucepan',1],['mixing-bowl','Mixing bowl',1]] }
];

const NORMAL = [
  ['plain-flour','Plain flour','1.80','🌾'],['self-raising-flour','Self-raising flour','2.20','🌾'],['caster-sugar','Caster sugar','2.10','🍚'],['brown-sugar','Brown sugar','2.40','🍯'],['icing-sugar','Icing sugar','2.60','☁️'],['unsalted-butter','Unsalted butter','4.20','🧈'],['salted-butter','Salted butter','4.20','🧈'],['whole-milk','Whole milk','1.70','🥛'],['double-cream','Double cream','2.90','🥛'],['free-range-eggs','Free-range eggs','3.20','🥚'],['cheddar-cheese','Cheddar cheese','4.60','🧀'],['mozzarella-cheese','Mozzarella cheese','4.40','🧀'],['parmesan-cheese','Parmesan cheese','5.75','🧀'],['cream-cheese','Cream cheese','3.10','🧀'],['spaghetti','Spaghetti','1.80','🍝'],['penne-pasta','Penne pasta','1.90','🍝'],['macaroni','Macaroni','1.70','🍝'],['lasagne-sheets','Lasagne sheets','2.40','🍝'],['white-rice','White rice','2.80','🍚'],['potatoes','Potatoes','2.30','🥔'],['carrots','Carrots','1.50','🥕'],['onions','Onions','1.40','🧅'],['garlic','Garlic','1.20','🧄'],['tomatoes','Tomatoes','2.70','🍅'],['mushrooms','Mushrooms','3.50','🍄'],['chicken-breast','Chicken breast','6.90','🍗'],['minced-beef','Minced beef','7.40','🥩'],['olive-oil','Olive oil','8.40','🫒'],['baking-powder','Baking powder','2.30','🥄'],['cocoa-powder','Cocoa powder','3.80','🍫'],['bread','Bread','2.80','🍞'],['bacon','Bacon','4.50','🥓'],['sausages','Sausages','4.75','🌭'],['spring-onions','Spring onions','1.90','🌱'],['soy-sauce','Soy sauce','3.20','🍶'],['tortilla-chips','Tortilla chips','2.60','🌽'],['biscuits','Digestive biscuits','2.40','🍪']
];
const EQUIPMENT = [
  ['mixing-bowl','Mixing bowl','9.99','🥣'],['wooden-spoon','Wooden spoon','4.75','🥄'],['whisk','Whisk','6.50','〰️'],['spatula','Spatula','8.99','🥄'],['frying-pan','Frying pan','24.00','🍳'],['saucepan','Saucepan','29.00','🍲'],['baking-tray','Baking tray','12.99','🍕'],['cake-tin','Cake tin','14.99','🍰'],['rolling-pin','Rolling pin','15.60','🪵'],['measuring-jug','Measuring jug','11.25','🥛'],['kitchen-scales','Kitchen scales','24.50','⚖️'],['measuring-spoons','Measuring spoons','7.50','🥄'],['colander','Colander','16.80','🥣'],['cheese-grater','Cheese grater','10.80','🧀'],['chopping-board','Chopping board','18.50','🪵'],['chefs-knife',"Chef's knife",'32.00','🔪'],['oven-gloves','Oven gloves','13.25','🧤'],['potato-masher','Potato masher','9.80','🥔'],['blender','Blender','44.00','🌀'],['toaster','Toaster','28.00','🍞'],['waffle-maker','Waffle maker','39.99','🧇']
];
const ABSURD = [
  ['linux-operating-system','Linux Operating System','149.99','🐧',null],['windows-xp-professional','Windows XP Professional','299.99','🪟',null],['gpu-4-ultra','GPU 4 Ultra','1999.99','🖥️',null],['rtx-9090','RTX 9090','4999.99','🎮',null],['quantum-cheese','Quantum Cheese','249.99','🧀',null],['liquid-wifi','Liquid Wi-Fi','89.99','📶',null],['anti-gravity-spatula','Anti-Gravity Spatula','149.99','🥄',null],['bluetooth-banana','Bluetooth Banana','79.99','🍌',null],['wireless-potato','Wireless Potato','199.99','🥔',null],['usb-c-carrot','USB-C Carrot','29.99','🥕',null],['hdmi-spaghetti','HDMI Spaghetti','59.99','🍝',null],['rgb-garlic','RGB Garlic','119.99','🧄',null],['gaming-onion-pro-max','Gaming Onion Pro Max','349.99','🧅',null],['8k-ultra-hd-bread','8K Ultra HD Bread','699.99','🍞',null],['invisible-milk','Invisible Milk','49.99','🥛',null],['premium-bottled-silence','Premium Bottled Silence','24.99','🫙',null],['cloud-storage-in-a-jar','Cloud Storage in a Jar','399.99','☁️',null],['nuclear-powered-kettle','Nuclear-Powered Kettle','8999.99','☢️',null],['ai-powered-fork','AI-Powered Fork','499.99','🍴',null],['self-aware-microwave','Self-Aware Microwave','2499.99','📡',null],['emergency-rubber-duck','Emergency Rubber Duck','9.99','🦆',null],['ram-sandwich','64GB RAM Sandwich','899.99','🥪',null],['wifi-cheese-grater','Wi-Fi Enabled Cheese Grater','349.99','🧀',null],['solar-ice-cube','Solar-Powered Ice Cube','99.99','🧊',null],['waterproof-water','Waterproof Water','14.99','💧',null],['virtual-reality-salt','Virtual Reality Salt','199.99','🧂',null],['rtx-tomato-sauce','RTX-Enabled Tomato Sauce','129.99','🍅',null],['quantum-egg','Quantum Computing Egg','749.99','🥚',null],['windows-95-seasoning','Windows 95 Seasoning','59.99','🪟',null],['ethernet-noodles','Ethernet Noodles','89.99','🍜',null],['overclocked-butter','Overclocked Butter','179.99','🧈',null],['5g-mushroom','5G-Compatible Mushroom','69.99','🍄',null],['ai-soup','Artificial Intelligence Soup','299.99','🥣',null],['bluetooth-rolling-pin','Bluetooth-Connected Rolling Pin','249.99','🪵',null],['phoenix-air-fryer-doom','PHOENIX Certified Air Fryer of Doom','9999.99','🔥',null]
];
const MATH = [
  ['mean-of-cheese','The Mean of Cheese','20.00','🧀','mean'],['square-root-potato','Square Root of Potato','7.07','🥔','sqrt'],['hypotenuse-bread','The Hypotenuse of Bread','12.34','🍞','hypotenuse'],['algebraic-apples','Algebraic Apples','8.88','🍎','algebra'],['percentage-pasta','Percentage of Pasta','6.66','🍝','percentage'],['median-milk','Median Milk','5.55','🥛','median'],['mode-mozzarella','Mode of Mozzarella','15.15','🧀','mode'],['fractional-fries','Fractional Fries','4.44','🍟','fraction'],['probability-pudding','Probability Pudding','18.18','🍮','probability'],['quadratic-quiche','Quadratic Quiche','22.22','🥧','quadratic'],['ratio-rice','Ratio Rice','3.33','🍚','ratio'],['decimal-doughnuts','Decimal Doughnuts','10.10','🍩','decimal'],['area-avocado','Area of Avocado','16.16','🥑','area'],['circumference-cheese','Circumference of Cheese','25.25','🧀','circumference'],['simultaneous-soup','Simultaneous Soup','30.30','🥣','simultaneous']
];

function id() { return crypto.randomBytes(24).toString('hex'); }
function code(prefix, length) { return prefix + crypto.randomInt(100000, 999999).toString().slice(0, length); }
function image(emoji, hue) {
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="280"><rect width="420" height="280" rx="24" fill="' + hue + '"/><text x="210" y="175" text-anchor="middle" font-size="130">' + emoji + '</text></svg>');
}
function pick(list) { return list[crypto.randomInt(list.length)]; }
function mathItem(kind) {
  if (kind === 'mean') {
    const start = 50 + crypto.randomInt(4) * 25;
    const weights = [0,1,2,3,4].map(n => start + n * 50);
    return { question: 'What is the mean weight of these five cheese blocks: ' + weights.join('g, ') + 'g?', answer: String(weights.reduce((a,b) => a+b, 0) / 5), hint: 'Add the five weights, then divide by five.' };
  }
  if (kind === 'hypotenuse') {
    const a = pick([3,5,6]), b = pick([4,8,8]);
    return { question: 'A bread triangle has sides ' + a + 'cm and ' + b + 'cm. What is its hypotenuse? (Round to 2 decimals.)', answer: Math.sqrt(a*a+b*b).toFixed(2), hint: 'Use √(a² + b²).' };
  }
  if (kind === 'algebra') return { question: 'If one Algebraic Apple is x + 4 and x = 6, what is the apple?', answer: '10', hint: 'Substitute x with 6.' };
  if (kind === 'percentage') return { question: 'What is 25% of 40 pieces of pasta?', answer: '10', hint: 'One quarter of 40.' };
  if (kind === 'median') return { question: 'What is the median of these milk carton weights: 900g, 1000g, 1100g, 1200g and 1300g?', answer: '1100', hint: 'Put the five values in order and choose the middle one.' };
  if (kind === 'mode') return { question: 'Which number is the mode of these mozzarella slices: 2, 3, 2, 4, 2?', answer: '2', hint: 'Choose the value that appears most often.' };
  if (kind === 'fraction') return { question: 'Simplify 6/8 of a tray of fries. Give a decimal if easier.', answer: '0.75', hint: 'Divide the numerator and denominator by their greatest common factor.' };
  if (kind === 'probability') return { question: 'A pudding tin has 1 chocolate, 2 vanilla and 1 lemon pudding. What is the probability of vanilla?', answer: '0.5', hint: 'Favourable outcomes divided by total outcomes.' };
  if (kind === 'quadratic') return { question: 'The quiche equation is x² - 9 = 0. What is the positive value of x?', answer: '3', hint: 'Which number multiplied by itself makes 9?' };
  if (kind === 'ratio') return { question: 'Rice and water use a 1:2 ratio. How many cups of water for 5 cups of rice?', answer: '10', hint: 'Multiply the second part of the ratio by five.' };
  if (kind === 'decimal') return { question: 'What is 1.25 + 2.75 doughnuts?', answer: '4', hint: 'Add the decimal parts carefully.' };
  if (kind === 'area') return { question: 'An avocado slice is a rectangle 8cm wide and 5cm long. What is its area?', answer: '40', hint: 'Area is width multiplied by length.' };
  if (kind === 'circumference') return { question: 'A cheese wheel has a diameter of 10cm. What is its circumference? Use π = 3.142 and round to 2 decimals.', answer: '31.42', hint: 'Circumference is π multiplied by diameter.' };
  if (kind === 'simultaneous') return { question: 'Soup equations: x + y = 10 and x - y = 2. What is x?', answer: '6', hint: 'Add the two equations together.' };
  const n = pick([9,16,25,36,49,64,81]);
  return { question: 'What is the square root of a potato weighing ' + n + 'kg?', answer: String(Math.sqrt(n)), hint: 'It is the positive square root.' };
}

function numericAnswerMatches(input, expected) {
  const a = Number(String(input || '').trim().replace(',', '.'));
  const b = Number(expected);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.011;
}

function catalogueItem(tuple, category) {
  const [key, name, price, emoji, mathKind] = tuple;
  const absurd = category === 'absurd' || category === 'maths';
  const description = mathKind
    ? 'A premium mathematical delicacy. Solving the label is included in the price.'
    : category === 'absurd'
      ? name + ' is a premium household innovation. It is absolutely not a normal kitchen product.'
      : category === 'equipment'
        ? 'A dependable kitchen essential with absolutely no suspicious firmware updates.'
        : 'Fresh, reliable and ready for a recipe that knows what it is doing.';
  const review = category === 'absurd'
    ? '“I have no idea what this does, but the packaging was very confident.”'
    : mathKind
      ? '“The question was easier than the returns policy.”'
      : '“Arrived promptly and behaved exactly like the picture.”';
  return { key, name, price, emoji, category, absurd, mathKind: mathKind || null, description, review };
}

const CATALOGUE = [
  ...NORMAL.map(x => catalogueItem(x, 'ingredients')),
  ...EQUIPMENT.map(x => catalogueItem(x, 'equipment')),
  ...ABSURD.map(x => catalogueItem(x, 'absurd')),
  ...MATH.map(x => catalogueItem(x, 'maths'))
];

function publicCatalogue() {
  return CATALOGUE.map(item => ({
    key:item.key, name:item.name, price:item.price, category:item.category,
    emoji:item.emoji, image:image(item.emoji, item.absurd ? '#ffe5cc' : '#eaf3ff'),
    description:item.description, review:item.review, rating:'4.5', reviews:128
  }));
}

function create(previousRecipe, requestedRecipe) {
  const choices = requestedRecipe
    ? RECIPES.filter(recipe => recipe.name === requestedRecipe)
    : RECIPES.length > 1
    ? RECIPES.filter(recipe => recipe.name !== previousRecipe)
    : RECIPES;
  const recipe = pick(choices);
  const byKey = new Map(CATALOGUE.map(item => [item.key, item]));
  const required = recipe.items.map(([key,,quantity]) => {
    const item = byKey.get(key);
    return { key, name:item.name, quantity };
  });
  const strange = [...ABSURD, ...MATH].sort(() => crypto.randomInt(3)-1).slice(0, pick([1,1,2]));
  strange.forEach(([key,, ,emoji,kind]) => {
    const item = byKey.get(key);
    required.push({ key, name:item.name, quantity:1, absurd:true, math:kind ? mathItem(kind) : null, emoji });
  });
  const products = CATALOGUE.map(item => ({
    key:item.key, name:item.name, price:item.price, category:item.category,
    emoji:item.emoji, image:image(item.emoji, item.absurd ? '#ffe5cc' : '#eaf3ff'),
    description:item.description, review:item.review, rating:(3 + crypto.randomInt(20) / 10).toFixed(1), reviews:crypto.randomInt(80, 240)
  }));
  const credentials = { email: 'phoenix' + crypto.randomInt(100000,999999) + '@example.com', accountId: 'PHX-' + crypto.randomInt(100000,999999), securityCode: 'GECKO-' + crypto.randomInt(1000,9999) };
  const token = id();
  return { token, recipe: recipe.name, required, products: [...products.values()], basket: {}, credentials, expiresAt: Date.now() + 5 * 60 * 1000, status: 'open', mathUnlocked: {} };
}

function state(challenge) {
  return { ok:true, recipe:challenge.recipe, required:challenge.required, products:challenge.products, basket:challenge.basket, credentials:challenge.credentials, expiresAt:challenge.expiresAt, status:challenge.status, mathUnlocked:challenge.mathUnlocked };
}
function expired(challenge) { return !challenge || challenge.status !== 'open' || Date.now() >= challenge.expiresAt; }
function ensureOpen(challenge) { if (expired(challenge)) return { ok:false, message:'This challenge has expired.' }; return null; }
function add(challenge, key, quantity, answer) {
  const bad = ensureOpen(challenge); if (bad) return bad;
  const item = challenge.required.find(x => x.key === key); if (!item) return { ok:false, message:'That item is not on your recipe.' };
  if (item.math && !challenge.mathUnlocked[key]) {
    if (!numericAnswerMatches(answer, item.math.answer)) return { ok:false, mathRequired:true, question:item.math.question, hint:item.math.hint, message:'That answer is not quite right. Try again.' };
    challenge.mathUnlocked[key] = true;
  }
  challenge.basket[key] = Math.max(0, Math.min(item.quantity, Number(quantity) || 0));
  return { ok:true, basket:challenge.basket, mathUnlocked:challenge.mathUnlocked };
}
function complete(challenge, credentials) {
  const bad = ensureOpen(challenge); if (bad) return bad;
  const missing = challenge.required.filter(x => (challenge.basket[x.key] || 0) < x.quantity);
  if (missing.length) return { ok:false, message:'Your basket is missing: ' + missing.map(x=>x.name).join(', ') };
  if (!credentials || credentials.email !== challenge.credentials.email || credentials.accountId !== challenge.credentials.accountId || credentials.securityCode !== challenge.credentials.securityCode) return { ok:false, message:'PHOENIXBANK payment declined. Check the fictional credentials and try again.' };
  challenge.status = 'complete'; return { ok:true };
}
module.exports = { create, state, add, complete, expired, publicCatalogue, RECIPES, NORMAL, EQUIPMENT, ABSURD, MATH, CATALOGUE: CATALOGUE.map(item => ({ ...item })) };
