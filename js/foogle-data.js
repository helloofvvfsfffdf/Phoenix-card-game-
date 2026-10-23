'use strict';

(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FoogleData = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const TEMPLATES = [
    { topics:['phoenix online','phoenix card','phoenix game'], type:'news', title:'PHOENIX Online Match Report: Four Heroes, One Suspiciously Confident Gecko', source:'The Daily Ember Desk', text:'A fictional table of four players produced dramatic card plays, questionable alliances, and one gecko-shaped theory nobody could verify.', date:'October 23, 2026' },
    { topics:['phoenix online','phoenix match','phoenix matches'], type:'news', title:'Player 2 Delivers Possibly the Worst PHOENIX Performance in History', source:'The Ember Ledger', text:'Player 1 is performing well, Player 3 is developing a promising strategy, and Player 4 is quietly preparing for victory. Meanwhile, Player 2 appears to be playing an entirely different game.', date:'October 22, 2026' },
    { topics:['phoenix match','phoenix matches','phoenix game'], type:'news', title:'BREAKING: Exciting PHOENIX Match Between Players 1, 2, 3 and 4!', source:'Fictional Match Telegraph', text:'Experts describe the opening roll as “technically a roll” and award the audience a commemorative imaginary badge.', date:'October 21, 2026' },
    { topics:['phoenix entertainment','phoenix'], type:'article', title:'PHOENIX Entertainment Announces New Department of Dramatic Point Counting', source:'The Officially Unofficial PHOENIX Bulletin', text:'The new department will count points, recount points, and occasionally ask whether a point feels fulfilled.', date:'October 20, 2026' },
    { topics:['phoenix online','phoenix entertainment'], type:'article', title:'Why PHOENIX Cards Keep Appearing at the Exact Wrong Moment', source:'The Strategic Pigeon Review', text:'Researchers blame timing, destiny, and a pigeon who declined to comment.', date:'October 19, 2026' },
    { topics:['weather in spain','spain weather','weather spain'], type:'weather', site:'foogle-weather.html', title:'Weather in Spain: Forecast Includes 47 Apples', source:'Foogle Weather Bureau', text:'Current temperature: {apples} apples. Feels like: {bananas} bananas. Chance of a sensible forecast: 3%.', date:'Today' },
    { topics:['weather in spain','spain weather'], type:'weather', title:'Spain Weather Alert: Mild Breezes, Strong Papaya Activity', source:'Cloudy With a Chance of Foogle', text:'Meteorologists recommend sunglasses, a light jacket, and not asking why the clouds are shaped like toast.', date:'Today' },
    { topics:['download more ram','more ram','ram download'], type:'article', title:'Download More RAM — Experts Explain Why the Button Is So Large', source:'The Hardware Whisperer', text:'The download begins at 2%, pauses to consider its options, and requests permission to install three extra keyboards.', date:'October 18, 2026' },
    { topics:['download more ram','more ram'], type:'article', title:'Local Computer Downloads 64 Gigabytes of RAM, Immediately Forgets Where It Put Them', source:'Byte-Sized Fiction News', text:'The computer remains optimistic and has filed a missing-memory report with itself.', date:'October 17, 2026' },
    { topics:['gaming computer','gaming computers','gaming pc'], type:'review', title:'The New Gaming Computer Has 900 Fans and One Extremely Nervous USB Port', source:'Joystick & Biscuit', text:'Performance is excellent, provided you enjoy the sound of a small weather system living under your desk.', date:'October 16, 2026' },
    { topics:['gaming computer','gaming computers'], type:'review', title:'Gaming PC Review: Runs Every Game, Including Chess Against a Goose', source:'The Loading Screen Journal', text:'Frame rates were measured in frames per second and one startled frame per goose.', date:'October 15, 2026' },
    { topics:['invisible socks','missing socks'], type:'article', title:'Scientists Locate Missing Socks in a Parallel Laundry Dimension', source:'The Household Mystery Review', text:'The socks are reportedly happy, mismatched, and unwilling to return without a tiny passport.', date:'October 14, 2026' },
    { topics:['moon cheese','cheese moon'], type:'article', title:'Moon Cheese Mission Delayed After Astronauts Pack Crackers for 14 People', source:'The Lunar Lunch Report', text:'Mission control says the moon remains edible in theory and absolutely not in practice.', date:'October 13, 2026' },
    { topics:['gecko','geckos'], type:'article', title:'Gecko Elected Chair of the Committee for Sitting Very Still', source:'The Reptile Roundabout', text:'The new chair accepted the role with a blink and a tiny, legally significant wave.', date:'October 12, 2026' },
    { topics:['time machine','time travel'], type:'article', title:'Time Machine Arrives Yesterday, Apologises Tomorrow', source:'The Chronology Chronicle', text:'Officials say the machine is working perfectly, although its warranty expired next Thursday.', date:'October 11, 2026' },
    { topics:['left handed spoon','spoon'], type:'article', title:'Left-Handed Spoon Industry Demands Equal Access to Soup', source:'The Cutlery Current', text:'A spokesperson said the soup has been unfairly favouring right-handed ladles for centuries.', date:'October 10, 2026' },
    { topics:['cloud storage','cloud'], type:'article', title:'Cloud Storage Company Admits Some Files Are Actually Weather', source:'The Digital Drizzle', text:'Customers can now download a spreadsheet, a photograph, or a small chance of rain.', date:'October 9, 2026' },
    { topics:['rtx 9090','rtx 10090','graphics card'], type:'product', site:'definitely-not-nvidia.html', title:'Definitely Not NVIDIA — RTX 9090 Has More VRAM Than Several Moons', source:'Foogle Hardware Index', text:'Visit the fictional manufacturer for benchmarks, specifications, and a comparison tool.', date:'Catalogue update' },
    { topics:['windows 13','windows 14','office 9000'], type:'product', site:'definitely-not-microsoft.html', title:'Definitely Not Microsoft Announces Windows 13 Installation Ceremony', source:'Foogle Software Desk', text:'The compatibility checker requires 512GB RAM, 14TB storage, and emotional maturity.', date:'Product bulletin' },
    { topics:['phoenix breaking news','breaking phoenix news'], type:'news', site:'phoenix-news.html', title:'PHOENIX News: Breaking Reports From an Entirely Imaginary Table', source:'Foogle News Index', text:'Read fictional reports about impossible matches, dramatic point counting, and the wrong game.', date:'Breaking-ish' },
    { topics:['history of computers','computer history'], type:'article', site:'definitely-not-wikipedia.html', title:'Definitely Not Wikipedia: History of Computers', source:'Foogle Encyclopedia Index', text:'An encyclopedia article begins sensibly, then explains why computers need tiny passports.', date:'Reference result' },
    { topics:['gaming pc problems','pc master potato'], type:'discussion', site:'definitely-not-reddit.html', title:'Definitely Not Reddit: Gaming PC Problems and Other Potato Emergencies', source:'Foogle Discussion Index', text:'Browse fictional communities where graphics cards charge rent and motherboards request therapy.', date:'Community result' },
    { topics:['iphone 47','iphone 47 pro'], type:'product', site:'definitely-not-apple.html', title:'Definitely Not Apple: iPhone 47 Pro Ultra Max Costs £19,999', source:'Foogle Premium Device Index', text:'Configure fictional storage, colours, and accessories with no checkout attached.', date:'Premium result' },
    { topics:['phoenix technologies','phoenix technology'], type:'corporate', site:'phoenix-technologies.html', title:'PHOENIX Technologies Opens Laboratory for Self-Aware Chairs', source:'Foogle Corporate Index', text:'Explore inventions, research and a simulated enquiry desk from the fictional division.', date:'Company announcement' },
    { topics:['grand theft toaster','five nights at tesco','potato edition'], type:'game', site:'definitely-not-steam.html', title:'Definitely Not Steam: Games That Require More Storage Than Sense', source:'Foogle Games Index', text:'Browse fictional games, ridiculous requirements, reviews, and a local pretend wishlist.', date:'Store update' }
  ];

  function normalise(query) { return String(query || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function matching(query) {
    const value = normalise(query);
    return TEMPLATES.filter(item => item.topics.some(topic => value.includes(topic) || topic.split(' ').every(word => value.includes(word))));
  }
  function shuffled(items) { return items.slice().sort(() => Math.random() - 0.5); }
  function fictionalResults(query) { return shuffled(matching(query)).slice(0, 5); }
  function weatherText(text) { return text.replace('{apples}', String(35 + Math.floor(Math.random() * 25))).replace('{bananas}', String(40 + Math.floor(Math.random() * 25))); }
  function article(query, template) {
    const item = template || matching(query)[0] || TEMPLATES[0];
    const winner = 1 + Math.floor(Math.random() * 4), disaster = 1 + Math.floor(Math.random() * 4);
    const events = ['a heroic dice roll','an illegal-looking amount of confidence','a card played upside down','a strategy described only as “vibes”','a dramatic pause lasting several seconds'];
    return { ...item, title: item.type === 'news' ? item.title.replace('Player 2', 'Player ' + disaster) : item.title, body:[item.text, 'Foogle analysts insist this is a fictional report and does not describe real players, real matches, or real events.', 'Commentator Nova Quill said: “I have seen many strategies, but never one that involved this much ceremonial pointing.”', 'The imaginary winner was Player ' + winner + ', who received the Golden Confusion Trophy after ' + events[Math.floor(Math.random() * events.length)] + '.'] };
  }
  return { TEMPLATES, normalise, matching, fictionalResults, weatherText, article };
}));
