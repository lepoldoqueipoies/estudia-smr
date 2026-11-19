import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function openTheme(saved) {
  const values=new Map(saved ? [['studia-theme',saved]] : []);
  const button={setAttribute(){},addEventListener(_,fn){this.click=fn;}};
  const document={documentElement:{dataset:{}},getElementById(){return button;},addEventListener(_,fn){fn();}};
  runInNewContext(readFileSync(new URL('../js/theme.js',import.meta.url),'utf8'),{document,localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}});
  return {document,button,values};
}
test('first visit uses dark mode',()=>{
  assert.equal(openTheme().document.documentElement.dataset.theme,'dark');
});
test('switch changes to light and persists across reload',()=>{
  const app=openTheme();app.button.click();
  assert.equal(app.document.documentElement.dataset.theme,'light');
  assert.equal(openTheme(app.values.get('studia-theme')).document.documentElement.dataset.theme,'light');
});
test('switch returns from light to dark',()=>{
  const app=openTheme('light');app.button.click();
  assert.equal(app.document.documentElement.dataset.theme,'dark');
  assert.equal(app.values.get('studia-theme'),'dark');
});