(() => {
  'use strict';
  const token = new URLSearchParams(location.search).get('token');
  const demoMode = new URLSearchParams(location.search).get('demo') === '1';
  let data = null, category = 'all', pendingMath = null;
  const $ = id => document.getElementById(id);
  const api = async (path, options = {}) => {
    const response = await fetch('/api/shopping/' + path + '?token=' + encodeURIComponent(token), { ...options, headers:{'Content-Type':'application/json', ...(options.headers||{})} });
    return response.json();
  };
  function message(text, error = false) { $('message').textContent = text || ''; $('message').className = text ? 'shop-message ' + (error ? 'error' : '') : ''; }
  function render() {
    if (!data) return;
    $('recipe-name').textContent = data.recipe;
    $('requirements').replaceChildren(...data.required.map(item => { const li = document.createElement('li'); const count = data.basket[item.key] || 0; li.textContent = (count >= item.quantity ? '✓ ' : '□ ') + item.name + ' × ' + item.quantity; if (item.absurd) li.className = 'absurd'; return li; }));
    $('credentials').replaceChildren(...[['Email',data.credentials.email],['Account ID',data.credentials.accountId],['Security code',data.credentials.securityCode]].flatMap(([a,b]) => { const dt=document.createElement('dt');dt.textContent=a;const dd=document.createElement('dd');dd.textContent=b;return [dt,dd]; }));
    const query = ($('search').value || '').toLowerCase();
    $('products').replaceChildren(...data.products.filter(p => (category === 'all' || (category === 'absurd' ? ['absurd','maths'].includes(p.category) : category === 'food' ? p.category === 'ingredients' : p.category === 'equipment')) && (!query || (p.name+' '+p.description).toLowerCase().includes(query))).map(productCard));
    $('basket-count').textContent = Object.values(data.basket).reduce((a,b)=>a+b,0);
  }
  function productCard(product) {
    const card=document.createElement('article'); card.className='product';
    const img=document.createElement('img'); img.src=product.image; img.alt=product.name;
    const body=document.createElement('div'); body.className='product-body';
    const h=document.createElement('h3');h.textContent=product.name;
    const price=document.createElement('strong');price.textContent='£'+product.price;
    const p=document.createElement('p');p.textContent=product.description+(product.review?' '+product.review:'');
    const rating=document.createElement('span');rating.className='rating';rating.textContent='★'.repeat(Math.round(Number(product.rating)))+' '+product.rating+' ('+product.reviews+')';
    const button=document.createElement('button');button.textContent=(data.basket[product.key]?'Add another':'Add to basket');button.onclick=()=>add(product);
    body.append(h,price,p,rating,button);card.append(img,body);return card;
  }
  async function add(product) {
    const required = data.required.find(x=>x.key===product.key);
    let answer;
    if (required && required.math && !data.mathUnlocked[product.key]) {
      pendingMath=product; $('math-question').textContent=required.math.question; $('math-hint').textContent=required.math.hint; $('math-answer').value=''; $('math-dialog').showModal(); return;
    }
    await addNow(product, answer);
  }
  async function addNow(product, answer) {
    if (demoMode) {
      const required = data.required.find(x => x.key === product.key);
      if (required && required.math && !data.mathUnlocked[product.key]) {
        if (String(answer || '').trim() !== required.math.answer) { message('That answer is not quite right. Try again.', true); return; }
        data.mathUnlocked[product.key] = true;
      }
      data.basket[product.key] = Math.min((data.basket[product.key] || 0) + 1, required ? required.quantity : 99);
      message(product.name + ' added to your basket.'); render(); return;
    }
    const result=await api('basket',{method:'POST',body:JSON.stringify({key:product.key,quantity:(data.basket[product.key]||0)+1,answer})});
    if (!result.ok) { message(result.message,true); return; }
    data.basket=result.basket; data.mathUnlocked=result.mathUnlocked || data.mathUnlocked; message(product.name+' added to your basket.'); render();
  }
  function renderBasket() {
    const lines=$('basket-lines');lines.replaceChildren();let total=0;
    Object.entries(data.basket).forEach(([key,qty])=>{const p=data.products.find(x=>x.key===key);if(!p)return;total+=Number(p.price)*qty;const row=document.createElement('div');row.className='basket-line';row.textContent=p.name+' × '+qty+' — £'+(Number(p.price)*qty).toFixed(2);lines.append(row);});
    $('total').textContent='£'+total.toFixed(2);
  }
  function demoData() {
    const svg = e => 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="280"><rect width="420" height="280" fill="#eaf3ff"/><text x="210" y="170" text-anchor="middle" font-size="120">'+e+'</text></svg>');
    const products=[['flour','Plain flour','1.80','🌾'],['eggs','Free-range eggs','3.20','🥚'],['mozzarella','Mozzarella','4.40','🧀'],['baking-tray','Baking tray','12.99','🍕'],['olive-oil','Extra virgin olive oil','8.40','🫒'],['tomato-sauce','Tomato sauce','2.75','🍅'],['mixing-bowl','Mixing bowl','9.99','🥣'],['garlic-press','Garlic press','12.50','🧄'],['quantum-cheese','Quantum Cheese','17.76','🧀'],['linux-seasoning','Linux Operating System Seasoning','42.00','🐧']].map(([key,name,price,emoji])=>({key,name,price,emoji,image:svg(emoji),description:'Freshly selected by an algorithm that has never cooked.',rating:'4.7',reviews:183,category:key==='baking-tray'||key==='mixing-bowl'||key==='garlic-press'?'equipment':['quantum-cheese','linux-seasoning'].includes(key)?'absurd':'food'}));
    return {ok:true,recipe:'Pizza',required:[{key:'flour',name:'Plain flour',quantity:2},{key:'eggs',name:'Free-range eggs',quantity:1},{key:'mozzarella',name:'Mozzarella',quantity:1},{key:'baking-tray',name:'Baking tray',quantity:1},{key:'quantum-cheese',name:'Quantum Cheese',quantity:1,absurd:true,math:{question:'What is the mean of 100g, 150g, 200g, 250g and 300g?',answer:'200',hint:'Add them and divide by five.'}}],products,basket:{},mathUnlocked:{},credentials:{email:'phoenix482731@example.com',accountId:'PHX-482731',securityCode:'GECKO-7284'},expiresAt:Date.now()+300000,status:'open'};
  }
  async function poll() { const next=await api('state'); if(!next.ok){message(next.message,true);return;} if(next.status!=='open'){ alert(next.status==='complete'?'Shopping challenge complete!':'Shopping challenge ended.'); window.close(); return; } data=next; render(); }
  $('search-form').onsubmit=e=>{e.preventDefault();render();};
  document.querySelectorAll('.categories button').forEach(btn=>btn.onclick=()=>{category=btn.dataset.category;document.querySelectorAll('.categories button').forEach(x=>x.classList.toggle('active',x===btn));render();});
  $('basket-button').onclick=()=>{$('basket-drawer').hidden=false;renderBasket();}; $('close-basket').onclick=()=>{$('basket-drawer').hidden=true;}; $('return-game').onclick=()=>window.close();
  $('checkout').onclick=()=>{renderBasket();$('checkout-message').textContent='';$('checkout-dialog').showModal();}; $('cancel-checkout').onclick=()=>$('checkout-dialog').close();
  $('math-submit').onclick=async e=>{e.preventDefault();$('math-dialog').close();await addNow(pendingMath,$('math-answer').value);};
  $('checkout-form').onsubmit=async e=>{e.preventDefault();const form=Object.fromEntries(new FormData(e.target));let result;if(demoMode){const missing=data.required.filter(item=>(data.basket[item.key]||0)<item.quantity);if(missing.length)result={ok:false,message:'Your basket is missing: '+missing.map(item=>item.name).join(', ')};else if(form.email!==data.credentials.email||form.accountId!==data.credentials.accountId||form.securityCode!==data.credentials.securityCode)result={ok:false,message:'PHOENIXBANK payment declined. Type the fictional credentials exactly as shown.'};else result={ok:true};}else result=await api('checkout',{method:'POST',body:JSON.stringify(form)});$('checkout-message').textContent=result.ok?'Payment accepted. Your order is completely imaginary.':result.message;$('checkout-message').className=result.ok?'success':'error';if(result.ok){data.status='complete';setTimeout(()=>window.close(),1200);}};
  (async()=>{if(demoMode){const preview=await fetch('/api/shopping/demo').then(response=>response.json()).catch(()=>null);data=preview&&preview.ok?preview:demoData();message('Preview mode — browsing a random recipe from the complete catalogue.');render();return;}if(!token){message('No shopping challenge token was supplied.',true);return;}data=await api('state');if(!data.ok){message(data.message,true);return;}render();setInterval(poll,4000);})();
})();
