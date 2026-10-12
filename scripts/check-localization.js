'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const dictionary = JSON.parse(fs.readFileSync(path.join(__dirname,'../src/public/locales/sk.json'),'utf8'));
for(const field of require('../src/settings/schema.json')) assert(dictionary[field.label], `Missing setting translation: ${field.label}`);
class Element {
 constructor(tag, attributes={}) {this.nodeType=1;this.tag=tag;this.attributes=attributes;this.childNodes=[];this.value='';}
 hasAttribute(key){return Object.hasOwn(this.attributes,key);}
 getAttribute(key){return this.attributes[key];}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(){}
 closest(selector){if(this.hasAttribute('data-no-translate') && selector.includes('[data-no-translate]'))return this;if(this.tag==='td' && selector==='td')return this;return null;}
}
const body=new Element('body');
const selector=new Element('select');
const heading=new Element('h2');const data=new Element('span',{'data-no-translate':''});
const headingText={nodeType:3,data:'Orders',parentElement:heading};heading.childNodes=[headingText];
const protectedText={nodeType:3,data:'Orders',parentElement:data};data.childNodes=[protectedText];
body.childNodes=[heading,data];
const storage=new Map();const spoken=[];
const window={dispatchEvent(){},alert:msg=>spoken.push(msg),confirm:msg=>{spoken.push(msg);return true;},prompt:msg=>{spoken.push(msg);return 'answer';}};
const sandbox={window,document:{body,documentElement:{},getElementById:()=>selector},localStorage:{getItem:key=>storage.get(key),setItem:(key,val)=>storage.set(key,val)},Node:{TEXT_NODE:3,ELEMENT_NODE:1},CustomEvent:class{},MutationObserver:class{disconnect(){}observe(){}},fetch:async()=>({ok:true,json:async()=>dictionary})};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/public/i18n.js'),'utf8'),sandbox);
(async()=>{
 await window.i18n.ready;
 window.i18n.setLanguage('sk');
 assert.equal(headingText.data,'Objednávky');assert.equal(protectedText.data,'Orders');
 assert.equal(window.i18n.t('Page 2 of 8'),'Strana 2 z 8');
 assert.equal(window.i18n.t('Mark order Orders as shipped and move it to Archive?'),'Odoslať objednávku Orders a presunúť ju do archívu?');
 window.confirm('Delete this backup file?');assert.equal(spoken.at(-1),'Odstrániť tento súbor zálohy?');
 assert.equal(storage.get('local-orders-language'),'sk');
 window.i18n.setLanguage('en');assert.equal(headingText.data,'Orders');assert.equal(protectedText.data,'Orders');
 assert.equal(window.i18n.t('Save'),'Save');assert.equal(selector.value,'en');
 console.log(`Localization passed: ${Object.keys(dictionary).length} entries, all setting labels, round-trip, user data and dialogs`);
})().catch(err=>{console.error(err);process.exitCode=1;});
