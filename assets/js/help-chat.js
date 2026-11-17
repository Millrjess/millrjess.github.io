(function(){
  var BOOKING_ENDPOINT="https://script.google.com/macros/s/AKfycby_8v8seWol3G1XXb9NlamfiYQTKA6Rk9pPHNqss1bTrSx1ONTVlY8BeG0Qg1m4vfKHaA/exec";
  var BOOKING_PAGE="../booking/";
  var STRIPE_STRATEGY_URL="https://buy.stripe.com/aFa7sMfCM43Nc8JdOF6EU02";
  var BOOK_ANSWER="I can book the free 15-minute discovery call right here. It is free, by phone, with no obligation, on a Tuesday or Thursday. A 1-hour strategy session is $200, paid in advance at booking through Stripe.";
  var answers=[
    {k:["strategy session","strategy"],a:"A 1-hour strategy session is $200, paid in advance at booking through Stripe, with a receipt. After payment, I will arrange a time with you and confirm every booking personally before it is final. If we cannot find a time that works, you will be refunded."},
    {k:["price","cost","fee","charge","rate"],a:"A 1-hour strategy session is $200, paid in advance. Care plans are $150 per month for Essential and $300 per month for Professional, with two months at no charge when paid annually. One time services start from $500 for a Site Health Audit and from $750 for a Website Standards Pass or a WCAG Accessibility Audit. See the full pricing page for every price."},
    {k:["book","consultation","session","appointment"],a:BOOK_ANSWER},
    {k:["free"],a:"The 15-minute discovery call is free, with no charge and no obligation. It is a phone call to discuss your website, your goals, and the problem you want to solve."},
    {k:["200","paid","pay","stripe","refund"],a:"A 1-hour strategy session is $200, paid in advance through Stripe, with a receipt. No session starts until payment is received. After payment, I will arrange a time with you and confirm every booking personally before it is final. If we cannot find a time that works, you will be refunded."},
    {k:["care plan","maintenance","support","monthly"],a:"Essential, $150 per month, includes CMS updates, daily off site backups, uptime monitoring, and a monthly site health report. Professional, $300 per month, adds security hardening and malware scanning, performance checks, one hour of content or design updates, and priority support."},
    {k:["audit","health"],a:"A Site Health Audit starts from $500 and reviews technical SEO, security configuration, and website performance, with a prioritized action plan."},
    {k:["seo"],a:"Technical SEO starts from $1,000. Work may include structured data, crawl and indexing fixes, page speed improvements, and GA4 measurement setup. Search rankings are not guaranteed."},
    {k:["accessib","wcag"],a:"A WCAG Accessibility Audit and Remediation starts from $750, with prioritized fixes to meet WCAG 2.1 AA, the legal benchmark version. A Website Standards Pass starts from $750 and corrects against WCAG 2.2 AA, the practice standard."},
    {k:["malware","hacked","security"],a:"Malware Removal and Incident Response starts from $500 per incident, including investigation, cleanup, vulnerability remediation, and security hardening within the agreed scope."},
    {k:["location","where","boston","andover","remote","onsite","zoom"],a:"Based in North Andover, MA 01845, serving Boston, Greater Boston's North Shore, and the Merrimack Valley, plus remote clients nationwide. Sessions are on Zoom, nationwide, and on-site by arrangement in Boston, Greater Boston's North Shore, and the Merrimack Valley, including the Andovers."},
    {k:["wordpress","drupal","joomla","platform"],a:"Ongoing care covers WordPress, Drupal, Joomla, and custom database driven websites."},
    {k:["start","begin","contact","email","phone"],a:"Start on the booking page, or email millrjess@gmail.com, or call (978) 267-5304. I read and reply to every inquiry personally."},
    {k:["agent","website agent","chatbot"],a:"Website Agents start from $2,500, for lead qualification, customer support, data processing, and multi step workflows. Integrations, permitted actions, and human review requirements are defined before development begins."}
  ];

  var siteIndex=[
    {k:["home","consultant","website operations"],u:"../",d:"Home: Jessica A. Miller, Website Operations Consultant, 20 years keeping business websites fast, secure, and online."},
    {k:["service","care plan","maintenance","seo","agent","audit","standards"],u:"../services/",d:"Services: care plans, one time projects, Website Agents, Standards Pass, technical SEO, and performance."},
    {k:["fee","price","pricing","cost"],u:"../pricing/",d:"Pricing: published prices for care plans, audits, development, agents, and strategy sessions, with pricing sources."},
    {k:["book","consultation","discovery","session","appointment"],u:"../booking/",d:"Booking: free 15-minute discovery call, and 1-hour strategy session, $200 paid in advance, approval before confirmation."},
    {k:["contact","email","phone","message"],u:"../contact/",d:"Contact: email millrjess@gmail.com, call (978) 267-5304, North Andover, MA."},
    {k:["faq","question","how"],u:"../faqs/",d:"FAQs: project timing, support, working with a team, prices, booking, refund, care plans, remote work, and platforms."},
    {k:["about","story","background","experience"],u:"../about/",d:"About: 20 years of website work, a six year break for full time parenting and writing, and a return to client work in 2026."},
    {k:["certif","course","credential"],u:"../certifications/",d:"Certifications: 34 course certificates with verification links."},
    {k:["recommend","testimonial","review"],u:"../testimonials/",d:"Testimonials: dated LinkedIn recommendations."},
    {k:["portfolio","project","case study","capstone"],u:"../portfolio/",d:"Work & Credentials: selected work in product, data, and design, plus course certificates and recommendations."},
    {k:["tracker","glp-1","new chapter","app"],u:"../tracker/",d:"New Chapter: GLP-1 Tracker™, an independent product by Jessica, separate from consulting services."},
    {k:["book","ledger","novel","author","fiction"],u:"../books/",d:"Books: The Ledger Series, The Second Account, The Echo Trace, and The Ghost Index."},
    {k:["checkr","background"],u:"https://checkr.com/profiles/jessica-miller-aa27",d:"Checkr public profile: identity verified, Website Operations Consultant, North Andover, MA."}
  ];
  function siteSearch(q){
    var hits=[];
    for(var i=0;i<siteIndex.length;i++){
      for(var j=0;j<siteIndex[i].k.length;j++){
        if(q.indexOf(siteIndex[i].k[j])>-1){ hits.push(siteIndex[i]); break; }
      }
    }
    if(!hits.length) return null;
    var out="I found this on the site: ";
    for(var h=0;h<Math.min(hits.length,3);h++){ out += "<a href='"+hits[h].u+"'>"+hits[h].d+"</a> "; }
    return out;
  }
  function find(q){
    q=q.toLowerCase();
    for(var i=0;i<answers.length;i++){
      for(var j=0;j<answers[i].k.length;j++){
        if(q.indexOf(answers[i].k[j])>-1) return answers[i].a;
      }
    }
    var s=siteSearch(q); if(s) return s;
    return "I do not have a published answer for that. Please email millrjess@gmail.com, call (978) 267-5304, or use the booking page, and Jessica will reply personally. This chat can book a free discovery call. Only Jessica can confirm a strategy session, change a price, or start work in this chat.";
  }
  /* Booking agent: books the free 15-minute discovery call in the chat.
     The call is free, by phone, Tuesday and Thursday, 10 AM to noon and
     1 to 3 PM Eastern. Strategy sessions are never booked here. */
  var bk={step:null,name:"",email:"",phone:"",website:"",topic:"",slots:[],slot:null,eventLabel:"",reschedEmail:"",booked:false};
  function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function hcLog(){ return document.getElementById("hc-log"); }
  function say(log,html){
    var d=document.createElement("div");
    d.innerHTML="<p style='margin:8px 0'>"+html+"</p>";
    log.appendChild(d);
    log.scrollTop=log.scrollHeight;
  }
  function validEmail(v){ var at=v.indexOf("@"); return at>0 && v.indexOf(".",at)>at+1; }
  function validPhone(v){ return v.replace(/\D/g,"").length>=7; }
  function isYes(q){ return q==="yes"||q==="yeah"||q==="sure"||q==="ok"||q==="okay"||q.indexOf("yes ")===0||q.indexOf("yes,")===0; }
  function isNo(q){ return q==="no"||q==="nope"||q.indexOf("no ")===0||q.indexOf("no,")===0; }
  function isBookIntent(q){
    return q.indexOf("book")>-1||q.indexOf("discovery")>-1||q.indexOf("appointment")>-1||q.indexOf("schedule")>-1||q.indexOf("consultation")>-1;
  }
  function isResched(q){
    return q.indexOf("reschedule")>-1||q.indexOf("move my")>-1||q.indexOf("change my call")>-1||q.indexOf("different time")>-1||q.indexOf("move it")>-1;
  }
  function bkReset(){ bk.step=null; bk.name=""; bk.phone=""; bk.website=""; bk.topic=""; bk.slots=[]; bk.slot=null; bk.reschedEmail=""; }
  function bkGet(url,cb){
    fetch(url).then(function(r){ return r.json(); }).then(function(j){ cb(j); }).catch(function(){ cb(null); });
  }
  function bkPost(data,cb){
    fetch(BOOKING_ENDPOINT,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(data)}).then(function(r){ return r.json(); }).then(function(j){ cb(j); }).catch(function(){ cb(null); });
  }
  function clearChoiceButtons(log){
    var old=log.querySelectorAll("button[data-hc-slot],button[data-hc-confirm]");
    for(var i=0;i<old.length;i++){ old[i].disabled=true; old[i].style.opacity="0.45"; }
  }
  function renderSlots(log,slots){
    clearChoiceButtons(log);
    var d=document.createElement("div");
    var html="";
    for(var i=0;i<slots.length;i++){
      html+="<button type='button' data-hc-slot='"+i+"' style='display:block;width:100%;text-align:left;background:#0b1a30;color:#fff;border:0;border-radius:10px;padding:.7em .9em;margin:6px 0;cursor:pointer;font:inherit'>"+esc(slots[i].label)+"</button>";
    }
    d.innerHTML=html;
    log.appendChild(d);
    log.scrollTop=log.scrollHeight;
  }
  function renderConfirm(log,yesLabel){
    clearChoiceButtons(log);
    var d=document.createElement("div");
    d.innerHTML="<button type='button' data-hc-confirm='yes' style='background:#f0dfae;color:#0b1a30;border:2px solid #0b1a30;border-radius:10px;padding:.7em 1em;margin:6px 6px 6px 0;cursor:pointer;font:inherit;font-weight:700'>"+yesLabel+"</button><button type='button' data-hc-confirm='no' style='background:#fff;color:#0b1a30;border:2px solid #0b1a30;border-radius:10px;padding:.7em 1em;margin:6px 0;cursor:pointer;font:inherit'>No, pick another time</button>";
    log.appendChild(d);
    log.scrollTop=log.scrollHeight;
  }
  function bkLoadSlots(log){
    bkGet(BOOKING_ENDPOINT+"?action=slots",function(res){
      if(!res||!res.success){ say(log,"Something went wrong. Please try again, or use the <a href='"+BOOKING_PAGE+"'>booking page</a>."); bkReset(); return; }
      if(!res.slots||!res.slots.length){
        say(log,"There are no open times in the next two weeks.");
        say(log,"You can book on the <a href='"+BOOKING_PAGE+"'>booking page</a>, email millrjess@gmail.com, or call (978) 267-5304.");
        bkReset(); return;
      }
      bk.slots=res.slots;
      say(log,"Here are the open times. Pick one:");
      renderSlots(log,res.slots);
    });
  }
  function bkDoBook(log){
    say(log,"Booking your call. One moment.");
    bkPost({action:"book",name:bk.name,email:bk.email,phone:bk.phone,website:bk.website,topic:bk.topic,start:bk.slot.start},function(res){
      if(res&&res.success){
        bk.booked=true;
        bk.eventLabel=res.label||bk.slot.label;
        say(log,"You are booked for "+esc(bk.eventLabel)+". Jessica will call you at "+esc(bk.phone)+".");
        say(log,"Would you like a 1-hour strategy session next? It is $200, paid at booking through Stripe. <a href='"+BOOKING_PAGE+"'>Booking page</a> or <a href='"+STRIPE_STRATEGY_URL+"'>pay on Stripe</a>.");
        bk.step=null;
      } else {
        say(log,esc(res&&res.message?res.message:"Something went wrong. Please try again."));
        bk.step="slots";
        bkLoadSlots(log);
      }
    });
  }
  function bkDoReschedule(log){
    say(log,"Moving your call. One moment.");
    var email=bk.booked?bk.email:bk.reschedEmail;
    bkPost({action:"reschedule",email:email,start:bk.slot.start},function(res){
      if(res&&res.success){
        bk.eventLabel=res.label||bk.slot.label;
        say(log,"Your call moved to "+esc(bk.eventLabel)+".");
        bk.step=null;
      } else {
        say(log,esc(res&&res.message?res.message:"Something went wrong. Please try again."));
        bk.step="resched-slots";
        bkLoadSlots(log);
      }
    });
  }
  function hcSlotPick(i){
    var log=hcLog();
    if(bk.step!=="slots"&&bk.step!=="resched-slots") return;
    var slot=bk.slots[i];
    if(!slot) return;
    bk.slot=slot;
    if(bk.step==="slots"){
      say(log,"You picked "+esc(slot.label)+". Jessica will call "+esc(bk.phone)+". Shall I book it?");
      bk.step="confirm";
      renderConfirm(log,"Yes, book it");
    } else {
      say(log,"You picked "+esc(slot.label)+". Shall I move your call to this time?");
      bk.step="resched-confirm";
      renderConfirm(log,"Yes, move it");
    }
  }
  function hcConfirm(v){
    var log=hcLog();
    if(bk.step==="confirm"){
      if(v==="yes"){ bkDoBook(log); return; }
      bk.step="slots";
      say(log,"Here are the open times. Pick one:");
      renderSlots(log,bk.slots);
      return;
    }
    if(bk.step==="resched-confirm"){
      if(v==="yes"){ bkDoReschedule(log); return; }
      bk.step="resched-slots";
      say(log,"Here are the open times. Pick one:");
      renderSlots(log,bk.slots);
    }
  }
  function bkHandle(q,raw,log){
    if(q==="cancel"||q==="stop"){ bkReset(); say(log,"No problem. Ask me anything else, or use the <a href='"+BOOKING_PAGE+"'>booking page</a>."); return; }
    if(bk.step==="offer"){
      if(q.indexOf("strategy")>-1){
        bkReset();
        say(log,find(q));
        say(log,"Pay for a 1-hour strategy session here: <a href='"+STRIPE_STRATEGY_URL+"'>Stripe payment link</a>.");
        return;
      }
      if(isYes(q)||q.indexOf("book")>-1){
        if(!BOOKING_ENDPOINT){ say(log,"Booking in the chat is not set up yet. Please use the <a href='"+BOOKING_PAGE+"'>booking page</a>."); bkReset(); return; }
        bk.step="name";
        say(log,"What is your name?");
        return;
      }
      bkReset();
      say(log,"No problem. Ask me anything else, or use the <a href='"+BOOKING_PAGE+"'>booking page</a>.");
      return;
    }
    if(bk.step==="name"){ bk.name=raw; bk.step="email"; say(log,"What email should I use?"); return; }
    if(bk.step==="email"){
      if(!validEmail(raw)){ say(log,"That email does not look right. What email should I use?"); return; }
      bk.email=raw; bk.step="phone"; say(log,"What phone number should Jessica call?"); return;
    }
    if(bk.step==="phone"){
      if(!validPhone(raw)){ say(log,"That phone number does not look right. What phone number should Jessica call?"); return; }
      bk.phone=raw; bk.step="website"; say(log,"What is your website? Type skip if you do not have one."); return;
    }
    if(bk.step==="website"){
      if(q!=="skip"&&q!=="none"&&q!=="no"&&q!=="no website"){ bk.website=raw; }
      bk.step="topic"; say(log,"What do you want help with?"); return;
    }
    if(bk.step==="topic"){ bk.topic=raw; bk.step="slots"; bkLoadSlots(log); return; }
    if(bk.step==="slots"){ say(log,"Please tap one of the times above."); return; }
    if(bk.step==="confirm"){
      if(isYes(q)){ bkDoBook(log); return; }
      if(isNo(q)){ bk.step="slots"; say(log,"Here are the open times. Pick one:"); renderSlots(log,bk.slots); return; }
      say(log,"Please tap Yes or No, or type yes or no.");
      return;
    }
    if(bk.step==="resched-email"){
      if(!validEmail(raw)){ say(log,"That email does not look right. What email did you book with?"); return; }
      bk.reschedEmail=raw; bk.step="resched-slots"; bkLoadSlots(log); return;
    }
    if(bk.step==="resched-slots"){ say(log,"Please tap one of the times above."); return; }
    if(bk.step==="resched-confirm"){
      if(isYes(q)){ bkDoReschedule(log); return; }
      if(isNo(q)){ bk.step="resched-slots"; say(log,"Here are the open times. Pick one:"); renderSlots(log,bk.slots); return; }
      say(log,"Please tap Yes or No, or type yes or no.");
      return;
    }
  }
  var btn=document.createElement("button");
  btn.id="hc-toggle";
  btn.innerHTML='<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
  btn.setAttribute("aria-label","Help chat");
  btn.setAttribute("aria-expanded","false");
  btn.style.cssText="position:fixed;outline-offset:2px;right:20px;bottom:20px;z-index:100;background:#f0dfae;color:#0b1a30;border:2px solid #0b1a30;border-radius:50%;width:56px;height:56px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 10px 22px -8px rgba(15,35,64,.35);font-family:inherit;padding:0";
  var panel=document.createElement("div");
  panel.setAttribute("role","dialog");
  panel.setAttribute("aria-label","Help chat");
  panel.style.cssText="display:none;position:fixed;right:20px;bottom:88px;z-index:100;width:400px;max-width:calc(100vw - 40px);background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 14px 34px -18px rgba(15,35,64,.22);padding:16px;font-family:inherit;color:#334155";
  panel.innerHTML="<div style='display:flex;justify-content:space-between;align-items:flex-start;gap:12px'><p style='margin:0;color:#0f2340;font-weight:700'>Help chat</p><button id='hc-close' aria-label='Close help chat' style='background:#f0dfae;border:2px solid #0b1a30;border-radius:999px;font-size:1em;font-weight:700;line-height:1;cursor:pointer;color:#0b1a30;padding:.25em .5em;min-width:32px;min-height:32px'>X</button></div><p style='margin:0 0 12px;font-size:.9em'>This help chat is not Jessica. It answers only from published pages on this site, and it links you to the page that covers your question. This chat can book a free discovery call. Only Jessica can confirm a strategy session, change a price, or start work.</p><div id='hc-log' aria-live='polite' role='status' style='font-size:.95em;max-height:300px;overflow-y:auto'></div><div style='display:flex;gap:8px;margin-top:12px;align-items:flex-end'><label for='hc-q' style='position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)'>Ask about prices or booking</label><input id='hc-q' type='text' aria-label='Ask about prices or booking' placeholder='Ask about prices or booking' style='flex:1;padding:.8em;border:1px solid #e2e8f0;border-radius:10px;font:inherit;font-size:1em'><button id='hc-send' style='background:#0b1a30;color:#fff;border:0;border-radius:10px;padding:.8em 1.2em;cursor:pointer;font:inherit;height:48px;flex-shrink:0'>Ask</button></div><p style='font-size:.85em;color:#64748b;margin:12px 0 0'>Try: How much is a strategy session? How do I book? What is in a care plan?</p>";
  var st=document.createElement("style"); st.textContent="#hc-toggle:focus-visible{outline:3px solid #0b1a30; outline-offset:2px; box-shadow:0 0 0 6px #f0dfae, 0 10px 22px -8px rgba(15,35,64,.35)}@media (max-width:720px){#hc-toggle{right:12px !important;bottom:12px !important;width:48px !important;height:48px !important}#hc-toggle svg{width:22px !important;height:22px !important}.site-footer{padding-bottom:76px}}"; document.head.appendChild(st);
  document.body.appendChild(btn); document.body.appendChild(panel);
  document.getElementById("hc-log").addEventListener("click",function(e){
    var t=e.target;
    while(t&&t!==this){
      if(t.getAttribute){
        var s=t.getAttribute("data-hc-slot");
        if(s!==null){ hcSlotPick(Number(s)); return; }
        var c=t.getAttribute("data-hc-confirm");
        if(c!==null){ hcConfirm(c); return; }
      }
      t=t.parentNode;
    }
  });
  /* The button stays visible at all times. It used to hide while scrolling,
     but that read as the chat disappearing, so the hide-on-scroll behavior
     was removed. The button is small and sits at the bottom-right corner. */
  function ask(){
    var inp=document.getElementById("hc-q"); var raw=inp.value.trim(); if(!raw) return;
    var q=raw.toLowerCase();
    var log=document.getElementById("hc-log");
    var d=document.createElement("div"); d.innerHTML="<p style='margin:8px 0'><strong>You:</strong> "+esc(raw)+"</p>"; log.appendChild(d); log.scrollTop=log.scrollHeight; inp.value="";
    if(bk.step){ bkHandle(q,raw,log); return; }
    if(q.indexOf("strategy")>-1){
      say(log,find(q));
      say(log,"Pay for a 1-hour strategy session here: <a href='"+STRIPE_STRATEGY_URL+"'>Stripe payment link</a>.");
      return;
    }
    if(isResched(q)){
      if(bk.booked&&bk.email){ bk.step="resched-slots"; bkLoadSlots(log); }
      else { bk.step="resched-email"; say(log,"I can move your discovery call. What email did you book with?"); }
      return;
    }
    if(isBookIntent(q)){
      if(!BOOKING_ENDPOINT){ say(log,"You can book a free discovery call on the <a href='"+BOOKING_PAGE+"'>booking page</a>."); return; }
      say(log,BOOK_ANSWER);
      say(log,"Shall I book a discovery call for you?");
      bk.step="offer";
      return;
    }
    var reply=find(q);
    say(log,reply);
    if(reply===BOOK_ANSWER){
      if(!BOOKING_ENDPOINT) return;
      say(log,"Shall I book a discovery call for you?");
      bk.step="offer";
    }
  }
  btn.onclick=function(){ var open = panel.style.display==="none"; panel.style.display = open ? "block" : "none"; btn.setAttribute("aria-expanded", open ? "true" : "false"); if(open) document.getElementById("hc-q").focus(); };
  document.getElementById("hc-close").onclick=function(){ panel.style.display="none"; btn.setAttribute("aria-expanded","false"); btn.focus(); };
  document.addEventListener("keydown", function(e){ if(e.key==="Escape" && panel.style.display!=="none"){ panel.style.display="none"; btn.setAttribute("aria-expanded","false"); btn.focus(); } });
  document.getElementById("hc-send").onclick=ask;
  document.getElementById("hc-q").addEventListener("keydown", function(e){ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); ask(); } });
})();
