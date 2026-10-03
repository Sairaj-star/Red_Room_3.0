const token=sessionStorage.getItem("rr_owner_token");if(!token)location.href="/";const $=s=>document.querySelector(s);
async function load(){const r=await fetch("/api/owner/rooms",{headers:{Authorization:"Bearer "+token}});if(r.status===401){sessionStorage.removeItem("rr_owner_token");location.href="/";return}
const {rooms}=await r.json();let av=0,occ=0,full=0;rooms.forEach(x=>x.status==="available"?av++:x.status==="full"?full++:occ++);$("#available").textContent=av;$("#occupied").textContent=occ;$("#full").textContent=full;
const list=$("#ownerRooms");list.innerHTML="";rooms.filter(r=>r.booked).forEach(room=>{const d=document.createElement("details");d.className="owner-room";d.innerHTML=`<summary><span><b>Room ${room.number}</b><br><small>${esc(room.booking?.name)} · ${room.occupants.length}/${room.capacity}</small></span><span class="status ${room.status==="full"?"full":""}">${room.status}</span></summary>
<div class="details"><div><span class="eyebrow">BOOKING</span><p>Name: ${esc(room.booking?.name)}<br>Phone: ${esc(room.booking?.phone)}<br>Capacity: ${room.capacity}<br>Key: <b>${esc(room.key)}</b></p></div>
<div><span class="eyebrow">OCCUPANTS</span><p>${room.occupants.map(o=>esc(o.label)+" · "+new Date(o.joinedAt).toLocaleString()).join("<br>")||"None"}</p></div>
<div><span class="eyebrow">ENTRY / EXIT AUDIT</span><pre>${esc(JSON.stringify(room.audit,null,2))}</pre></div>
<div><span class="eyebrow">MESSAGES / MEDIA</span><pre>${esc(JSON.stringify(room.messages,null,2))}</pre></div></div>
<button class="danger reset" data-room="${room.number}">Close / Reset Room</button>`;list.appendChild(d)});
document.querySelectorAll(".reset").forEach(b=>b.onclick=async()=>{if(confirm("Close this room?")){await fetch(`/api/rooms/${b.dataset.room}/reset`,{method:"POST",headers:{Authorization:"Bearer "+token}});load()}})}
function esc(s){const d=document.createElement("div");d.textContent=s??"";return d.innerHTML}$("#logout").onclick=()=>{sessionStorage.removeItem("rr_owner_token");location.href="/"};load();setInterval(load,5000);
