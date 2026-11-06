/* Tracker sales page help chat.
   Rule-based, browser only, no external AI and no API key. It answers
   only from the text on the tracker sales page, and it links to the
   section that covers the question. It is not Jessica, and it cannot
   take a payment or change a subscription. Every answer matches the
   sales page wording. No em dashes in any copy.
   Mirrors the structure of assets/js/help-chat.js, with tracker-only
   answers, so no consulting answers can leak into it. */
(function(){
  var answers=[
    {k:["cancel","refund","30 day","unsubscribe"],a:"Cancel anytime. Website subscriptions cancel by emailing <a href=\"mailto:millrjess@gmail.com\">millrjess@gmail.com</a>. Play subscriptions cancel in the Play Store. When you cancel, you keep access for the time you have already paid for, and you are not charged again. First subscription refund: full refund on request within the first 30 days. After 30 days, no partial refund for the current month or year. Duplicate charges, charges after a confirmed cancellation, and clear payment errors are always refunded in full. For subscription, cancellation, or refund help, email <a href=\"mailto:millrjess@gmail.com\">millrjess@gmail.com</a>. Replies within 1 business day. See the <a href=\"#faq\">frequently asked questions</a>."},
    {k:["medical advice","diagnose","doctor","clinician","prescriber","should i take","is it safe"],a:"New Chapter: GLP-1 Tracker\u2122 is a personal organization tool. It does not diagnose, treat, or replace professional medical advice. Always follow the medication instructions from your prescriber. See the <a href=\"#faq\">frequently asked questions</a>."},
    {k:["only zepbound","only for","wegovy","ozempic","mounjaro","glp-1","which medication","what medication"],a:"No. The tracker is designed for people using Zepbound, Wegovy, Ozempic, Mounjaro, and other GLP-1 medications. You can record your own medication and dose. See the <a href=\"#faq\">frequently asked questions</a>."},
    {k:["water goal","water","hydration","drink"],a:"Yes. The water goal is adjustable in Settings. Individual hydration needs vary, so follow any guidance your healthcare professional has given you. See the <a href=\"#faq\">frequently asked questions</a>."},
    {k:["movement","walk","stretch","exercise","workout","strength"],a:"You can record daily movement with quick entries you log in one tap, for walks, stretching, and more. See the <a href=\"#faq\">frequently asked questions</a>."},
    {k:["companion","ai wellness","assistant","memory","chat"],a:"Your personal AI Wellness Companion is included. It notices your streaks, speaks first, and remembers you when you ask it to. It gives encouragement, not medical advice. It allows 20 messages per device per day to start, and the limit rises as more paying subscribers join. See <a href=\"#features\">everything in one calm place</a>."},
    {k:["privacy","private","my data","sell my","shared","on my device"],a:"Everything you track stays on your device. It is never sent, sold, or shared. Free apps sell your data, give you no privacy, and show you ads. This one does not."},
    {k:["available","play store","google play","android","coming","launch"],a:"The website version is available now. Subscribe above and you will receive the app link by email. The Play Store version is coming later. See <a href=\"#pricing\">pricing</a>."},
    {k:["demo","try it","sample"],a:"You can try the demo with no sign-in and sample data only. <a href=\"https://millrjess.github.io/tracker-demo/\">Try the demo</a>."},
    {k:["price","cost","how much","per month","per year","3.99","29.99"],a:"New Chapter: GLP-1 Tracker\u2122 is $3.99 a month or $29.99 a year, and you can cancel anytime. The annual plan saves 37%. See <a href=\"#pricing\">pricing</a>."},
    {k:["subscribe","sign up","get started","how do i get","buy","purchase","download"],a:"Subscribe from the <a href=\"#pricing\">pricing section</a> and you will receive the app link by email. Secure payment through Stripe."},
    {k:["track","feature","what can i record","what does it do","injection","shot","weight","photo","journal","diary","mood","side effect"],a:"Track medication, injections, weight, protein, hydration, movement, and side effects. It also has a weight chart with a goal line, a diary and side effects log, progress photos, and a monthly review. Everything you track stays on your device. See <a href=\"#features\">everything in one calm place</a>."},
    {k:["email","contact","help","support","question","human","reply"],a:"Email <a href=\"mailto:millrjess@gmail.com\">millrjess@gmail.com</a> for subscription, cancellation, or refund help. Replies within 1 business day."}
  ];

  function find(q){
    q=q.toLowerCase();
    for(var i=0;i<answers.length;i++){
      for(var j=0;j<answers[i].k.length;j++){
        if(q.indexOf(answers[i].k[j])>-1) return answers[i].a;
      }
    }
    return "I do not have a published answer for that. Please email <a href=\"mailto:millrjess@gmail.com\">millrjess@gmail.com</a> and Jessica will reply personally. I cannot take a payment or change a subscription in this chat.";
  }
  var btn=document.createElement("button");
  btn.id="thc-toggle";
  btn.textContent="Help chat";
  btn.setAttribute("aria-expanded","false");
  btn.style.cssText="position:fixed;outline-offset:2px;right:20px;bottom:20px;z-index:100;background:#E8B54A;color:#233027;border:2px solid #5A6B52;border-radius:999px;padding:.7em 1.2em;font-weight:700;cursor:pointer;box-shadow:0 10px 22px -8px rgba(50,66,48,.35);font-family:inherit";
  var panel=document.createElement("div");
  panel.id="thc-panel";
  panel.setAttribute("role","dialog");
  panel.setAttribute("aria-label","Help chat");
  panel.style.cssText="display:none;position:fixed;right:20px;bottom:76px;z-index:100;width:400px;max-width:calc(100vw - 40px);background:#FDFBF7;border:1px solid #d5dccf;border-radius:16px;box-shadow:0 14px 34px -18px rgba(50,66,48,.22);padding:16px;font-family:inherit;color:#233027";
  panel.innerHTML="<div style='display:flex;justify-content:space-between;align-items:flex-start;gap:12px'><p style='margin:0;color:#44503E;font-weight:700'>Help chat</p><button id='thc-close' aria-label='Close help chat' style='background:#E8B54A;border:2px solid #5A6B52;border-radius:999px;font-size:1em;font-weight:700;line-height:1;cursor:pointer;color:#233027;padding:.25em .5em;min-width:32px;min-height:32px'>X</button></div><p style='margin:0 0 12px;font-size:.9em'>This help chat is not Jessica. It answers only from this sales page, and it links you to the section that covers your question. I cannot take a payment or change a subscription.</p><div id='thc-log' aria-live='polite' role='status' style='font-size:.95em;max-height:300px;overflow-y:auto'></div><div style='display:flex;gap:8px;margin-top:12px;align-items:flex-end'><label for='thc-q' style='position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)'>Ask about price, cancelling, or the tracker</label><textarea id='thc-q' rows='3' aria-label='Ask about price, cancelling, or the tracker' placeholder='Ask about price, cancelling, or the tracker' style='flex:1;padding:.8em;border:1px solid #d5dccf;border-radius:10px;font:inherit;font-size:1em;resize:vertical;background:#fff;color:#233027'></textarea><button id='thc-send' style='background:#5A6B52;color:#fff;border:0;border-radius:10px;padding:.8em 1.2em;cursor:pointer;font:inherit;height:48px;flex-shrink:0'>Ask</button></div><p style='font-size:.85em;color:#4a554c;margin:12px 0 0'>Try: How much does it cost? How do I cancel? Is it available now? Does it give medical advice?</p>";
  var st=document.createElement("style"); st.textContent="#thc-toggle:focus-visible{outline:3px solid #5A6B52; outline-offset:2px; box-shadow:0 0 0 6px #E8B54A, 0 10px 22px -8px rgba(50,66,48,.35)} #thc-close:focus-visible, #thc-send:focus-visible, #thc-q:focus-visible{outline:3px solid #5A6B52; outline-offset:2px} @media (max-width:620px){ #thc-toggle{bottom:92px} #thc-panel{bottom:148px} }"; document.head.appendChild(st);
  document.body.appendChild(btn); document.body.appendChild(panel);
  function ask(){
    var inp=document.getElementById("thc-q"); var q=inp.value.trim(); if(!q) return;
    var log=document.getElementById("thc-log");
    var d=document.createElement("div"); d.innerHTML="<p style='margin:8px 0'><strong>You:</strong> "+q.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")+"</p><p style='margin:8px 0'>"+find(q)+"</p>"; log.appendChild(d); inp.value="";
  }
  btn.onclick=function(){ var open = panel.style.display==="none"; panel.style.display = open ? "block" : "none"; btn.setAttribute("aria-expanded", open ? "true" : "false"); if(open) document.getElementById("thc-q").focus(); };
  document.getElementById("thc-close").onclick=function(){ panel.style.display="none"; btn.setAttribute("aria-expanded","false"); btn.focus(); };
  document.addEventListener("keydown", function(e){ if(e.key==="Escape" && panel.style.display!=="none"){ panel.style.display="none"; btn.setAttribute("aria-expanded","false"); btn.focus(); } });
  document.getElementById("thc-send").onclick=ask;
  document.getElementById("thc-q").addEventListener("keydown", function(e){ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); ask(); } });
})();
