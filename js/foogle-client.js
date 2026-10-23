(() => {
  'use strict';
  const $=id=>document.getElementById(id), data=window.FoogleData;
  let lastQuery='';
  function renderResults(query, items){
    $('results-label').textContent=query?'Results for “'+query+'”':'Popular searches';
    const root=$('results'); root.replaceChildren();
    if(!items.length){root.append(Object.assign(document.createElement('p'),{className:'empty',textContent:'Foogle found nothing useful. Google may have better luck.'}));return;}
    items.forEach((item,index)=>{const card=document.createElement('article');card.className='result';card.tabIndex=0;const source=document.createElement('div');source.className='source';source.textContent=item.source+' · '+item.date;const heading=document.createElement('h2');heading.textContent=item.title;const body=document.createElement('p');body.textContent=item.type==='weather'?data.weatherText(item.text):item.text;const badge=document.createElement('span');badge.className='badge';badge.textContent=item.type==='news'?'FOOGLE NEWS':'FICTIONAL RESULT';card.append(source,heading,body,badge);card.onclick=()=>openArticle(item);card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openArticle(item);}};root.append(card);});
  }
  function openArticle(item){$('results-view').hidden=true;$('article-view').hidden=false;const article=data.article(lastQuery,item),root=$('article');root.className='article';root.replaceChildren();root.append(Object.assign(document.createElement('div'),{className:'kicker',textContent:item.type==='news'?'Foogle News':'Foogle Feature'}),Object.assign(document.createElement('h1'),{textContent:article.title}),Object.assign(document.createElement('div'),{className:'byline',textContent:article.source+' · '+article.date}));article.body.forEach((paragraph,index)=>{const node=document.createElement(index===2?'blockquote':'p');node.textContent=paragraph;if(index===2)node.className='quote';root.append(node);});const disclaimer=document.createElement('p');disclaimer.className='disclaimer';disclaimer.textContent='Foogle fiction notice: this is a parody article generated from fictional templates. It does not describe real PHOENIX players, matches, scores, or events.';root.append(disclaimer);window.scrollTo({top:0,behavior:'smooth'});}
  $('foogle-form').onsubmit=e=>{e.preventDefault();const query=$('foogle-query').value.trim();if(!query)return;$('article-view').hidden=true;$('results-view').hidden=false;lastQuery=query;const special=data.fictionalResults(query);if(special.length)renderResults(query,special);else window.open('https://www.google.com/search?q='+encodeURIComponent(query),'_blank','noopener');};
  $('back-results').onclick=()=>{$('article-view').hidden=true;$('results-view').hidden=false;};
  renderResults('',data.TEMPLATES.slice(0,4));
})();
