// Interface translations only: note contents, Scribe text and filenames stay untouched.
window.apoxiaI18n = (() => {
  let language=localStorage.getItem('apoxia-language')==='en'?'en':'es';
  let dictionary={},reverse=new Map(),patterns=[];
  const dynamicSources=new Map();
  const attributes=['title','aria-label','placeholder'];
  const ignored='#writingLayer,#writingDetail,#writingEditor,.canvas-writing,.text-editor,.note-links-view,.card-name,.vault-cipher,[data-i18n-ignore]';
  const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  function t(value) {
    if(typeof value!=='string') return value;
    const source=dynamicSources.get(value) || reverse.get(value) || value;
    if(language!=='en') return source;
    if(dictionary[source]) return dictionary[source];
    for(const {regex,english,names} of patterns) {
      const match=regex.exec(source);
      if(match) {
        const values=Object.fromEntries(names.map((name,index)=>[name,match[index+1]]));
        return rememberSource(source,english.replace(/\{(\w+)\}/g,(_,name)=>values[name]));
      }
    }
    const count=/^(\d+) (referencias?|trazos?)$/.exec(source);
    if(count) return rememberSource(source,`${count[1]} ${dictionary[count[2]]}`);
    const summary=/^(\d+) referencias?, (\d+) trazos? y (\d+) textos? vectorial(?:es)?$/.exec(source);
    if(summary) return rememberSource(source,`${summary[1]} reference${summary[1]==='1'?'':'s'}, ${summary[2]} stroke${summary[2]==='1'?'':'s'} and ${summary[3]} vector text${summary[3]==='1'?'':'s'}`);
    return source;
  }
  function rememberSource(source,translated) {
    if(dynamicSources.size>=256) dynamicSources.delete(dynamicSources.keys().next().value);
    dynamicSources.set(translated,source);return translated;
  }
  function translateTree(root) {
    const elements=root.querySelectorAll('*');
    for(const element of elements) {
      if(element.closest(ignored)) continue;
      for(const attribute of attributes) {
        // A card's accessible name is its user-provided name.
        if(attribute==='aria-label' && element.matches('.video-card,.canvas-writing')) continue;
        if(element.hasAttribute(attribute)) {
          const value=element.getAttribute(attribute),translated=t(value);
          if(translated!==value) element.setAttribute(attribute,translated);
        }
      }
      for(const node of element.childNodes) if(node.nodeType===Node.TEXT_NODE && node.nodeValue.trim()) {
        const raw=node.nodeValue,source=raw.trim(),translated=t(source);
        if(translated!==source) node.nodeValue=raw.replace(source,translated);
      }
    }
  }
  function html(markup) {
    const template=document.createElement('template');template.innerHTML=markup;
    translateTree(template.content);return template.innerHTML;
  }
  function apply() {
    document.documentElement.lang=language;
    translateTree(document.body);
    const selector=document.querySelector('#languageChoice');if(selector) selector.value=language;
  }
  async function setLanguage(next) {
    language=next==='en'?'en':'es';localStorage.setItem('apoxia-language',language);
    apply();window.dispatchEvent(new Event('apoxia-language-change'));
    try {await window.apoxiaDesktop?.setLanguage?.(language);} catch(error) {console.error(error);}
  }
  async function init() {
    const response=await fetch('/locales/en.json');
    if(!response.ok) throw new Error('Could not load interface translations');
    dictionary=await response.json();
    reverse=new Map(Object.entries(dictionary).map(([es,en])=>[en,es]));
    patterns=Object.entries(dictionary).filter(([es])=>/\{\w+\}/.test(es)).map(([es,english])=> {
      const names=[];let expression='',previous=0;
      for(const match of es.matchAll(/\{(\w+)\}/g)) {
        expression+=escape(es.slice(previous,match.index))+'(.+?)';names.push(match[1]);previous=match.index+match[0].length;
      }
      expression+=escape(es.slice(previous));
      return {regex:new RegExp(`^${expression}$`),english,names};
    });
    apply();document.querySelector('#languageChoice').addEventListener('change',event=>setLanguage(event.target.value));
  }
  return {t,html,apply,init,setLanguage,get language(){return language;},get locale(){return language==='en'?'en-US':'es-ES';}};
})();
