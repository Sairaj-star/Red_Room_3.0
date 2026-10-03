const $=s=>document.querySelector(s);let selectedRoom=null;
async function loadRooms(){const r=await fetch("/api/rooms"),{rooms}=await r.json(),grid=$("#roomGrid");grid.innerHTML="";
for(const room of rooms){const b=document.createElement("button");b.className="room "+room.status;b.disabled=room.status==="full";
b.innerHTML=`<span class="rno">Room ${room.number}</span><small>${room.status==="available"?"Available":room.status==="full"?"Full":`${room.occupants}/${room.capacity} occupied`}</small>`;
if(room.status!=="full")b.onclick=()=>openBooking(room.number);grid.appendChild(b)}}
function show(id){document.querySelectorAll("section.panel").forEach(x=>x.classList.add("hidden"));$(id).classList.remove("hidden");window.scrollTo({top:0,behavior:"smooth"})}
function openBooking(n){selectedRoom=n;$("#bookingRoomNo").textContent=n;show("#booking")}
$("#enterBtn").onclick=()=>{$("#reception").classList.remove("hidden");$("#reception").scrollIntoView({behavior:"smooth"})};
document.querySelectorAll("[data-role]").forEach(b=>b.onclick=()=>b.dataset.role==="customer"?(show("#rooms"),loadRooms()):show("#ownerLogin"));
$("#joinKeyBtn").onclick=()=>show("#joinPanel");document.querySelectorAll(".backBtn").forEach(b=>b.onclick=()=>show("#reception"));
$("#bookingForm").onsubmit=async e=>{e.preventDefault();$("#bookingError").textContent="";const body={name:$("#name").value.trim(),phone:$("#phone").value.trim(),capacity:Number($("#capacity").value)};
const r=await fetch(`/api/rooms/${selectedRoom}/book`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),d=await r.json();
if(!r.ok){$("#bookingError").textContent=d.error||"Could not book room.";return}$("#newKey").textContent=d.key;sessionStorage.setItem("rr_room",selectedRoom);sessionStorage.setItem("rr_key",d.key);show("#keyPanel")};
$("#continueRoom").onclick=()=>location.href="/room.html";
$("#joinForm").onsubmit=e=>{e.preventDefault();$("#joinError").textContent="";const n=Number($("#joinRoom").value),key=$("#joinKey").value.trim().toUpperCase();if(!Number.isInteger(n)||n<1||n>500||key.length!==9){$("#joinError").textContent="Enter a valid room number and 9-character key.";return}sessionStorage.setItem("rr_room",n);sessionStorage.setItem("rr_key",key);location.href="/room.html"};
$("#ownerForm").onsubmit=async e=>{e.preventDefault();$("#ownerError").textContent="";const r=await fetch("/api/owner/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:$("#ownerEmail").value,password:$("#ownerPassword").value})}),d=await r.json();if(!r.ok){$("#ownerError").textContent=d.error||"Login failed.";return}sessionStorage.setItem("rr_owner_token",d.token);location.href="/owner.html"};
