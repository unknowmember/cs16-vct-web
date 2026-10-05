const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(__dirname));

// Map Pool chuẩn CS 1.6
const MAP_POOL = ["de_dust2", "de_inferno", "de_nuke", "de_train", "de_aztec", "de_cbble", "de_prodigy"];

// Lưu trữ dữ liệu trong bộ nhớ (In-Memory Data)
let users = [
    { 
        id: 'usr_admin', 
        username: 'admin', 
        password: '123', 
        role: 'ADMIN', 
        token: 'ADMIN_TOKEN_VCT_999', 
        teamId: null 
    }
];
let teams = [];
let matches = [];

// Các hàm tiện ích tra cứu
const findUser = (id) => users.find(u => u.id === id);
const findTeam = (id) => teams.find(t => t.id === id);
const findMatch = (id) => matches.find(m => m.id === id);

// =========================================================================
// 1. API ĐĂNG NHẬP & ĐĂNG KÝ
// =========================================================================
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(400).json({ error: 'Tài khoản hoặc mật khẩu không chính xác!' });
    res.json({ user });
});

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Vui lòng điền đầy đủ tên và mật khẩu!' });
    if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Tên tài khoản đã tồn tại!' });

    const newUser = {
        id: 'usr_' + Date.now(),
        username,
        password,
        role: 'PLAYER',
        token: 'TK_' + Math.random().toString(36).substring(2, 8).toUpperCase(),
        teamId: null
    };
    users.push(newUser);
    res.json({ user: newUser });
});

// =========================================================================
// 2. API QUẢN LÝ ĐỘI (TEAM CREATION & JOIN)
// =========================================================================
app.post('/api/team/create', (req, res) => {
    const { userId, teamName, teamPassword } = req.body;
    const user = findUser(userId);
    if (!user) return res.status(400).json({ error: 'Tài khoản không tồn tại!' });
    if (user.teamId) return res.status(400).json({ error: 'Bạn đã ở trong một đội khác rồi!' });
    if (teams.find(t => t.name === teamName)) return res.status(400).json({ error: 'Tên đội này đã được đăng ký!' });

    const newTeam = {
        id: 'team_' + Date.now(),
        name: teamName,
        password: teamPassword,
        leaderId: user.id,
        members: [{ userId: user.id, username: user.username, isLeader: true }]
    };

    teams.push(newTeam);
    user.teamId = newTeam.id;
    res.json({ team: newTeam });
});

app.post('/api/team/join', (req, res) => {
    const { userId, teamName, teamPassword } = req.body;
    const user = findUser(userId);
    if (!user) return res.status(400).json({ error: 'Tài khoản không tồn tại!' });
    if (user.teamId) return res.status(400).json({ error: 'Bạn đã ở trong một đội khác rồi!' });

    const team = teams.find(t => t.name === teamName && t.password === teamPassword);
    if (!team) return res.status(400).json({ error: 'Tên đội hoặc mật khẩu đội không đúng!' });

    team.members.push({ userId: user.id, username: user.username, isLeader: false });
    user.teamId = team.id;
    res.json({ team });
});

app.get('/api/teams', (req, res) => {
    res.json(teams);
});

// =========================================================================
// 3. API ADMIN QUẢN TRỊ & XẾP CẶP BRACKET
// =========================================================================
app.post('/api/admin/delete-team', (req, res) => {
    const { userId, teamId } = req.body;
    const user = findUser(userId);
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Quyền truy cập bị từ chối: Chỉ dành cho Admin!' });

    teams = teams.filter(t => t.id !== teamId);
    users.forEach(u => { if (u.teamId === teamId) u.teamId = null; });
    matches = matches.filter(m => m.teamA?.id !== teamId && m.teamB?.id !== teamId);

    res.json({ success: true });
});

app.post('/api/admin/setup-bracket', (req, res) => {
    const { userId, pairings } = req.body;
    const user = findUser(userId);
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Quyền truy cập bị từ chối: Chỉ dành cho Admin!' });

    matches = pairings.map((p, index) => {
        const teamA = findTeam(p.teamAId);
        const teamB = findTeam(p.teamBId);
        return {
            id: 'match_' + (index + 1),
            teamA: teamA ? { id: teamA.id, name: teamA.name } : null,
            teamB: teamB ? { id: teamB.id, name: teamB.name } : null,
            scoreA: 0,
            scoreB: 0,
            status: 'WAITING',
            bo3Maps: []
        };
    });

    res.json({ matches });
});

app.post('/api/admin/start-match', (req, res) => {
    const { userId, matchId } = req.body;
    const user = findUser(userId);
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Quyền truy cập bị từ chối: Chỉ dành cho Admin!' });

    const match = findMatch(matchId);
    if (!match) return res.status(404).json({ error: 'Không tìm thấy trận đấu!' });

    match.status = 'PICKING_MAP1';
    res.json({ match });
});

// =========================================================================
// 4. API TRUY VẤN DASHBOARD TỔNG QUAN
// =========================================================================
app.get('/api/dashboard', (req, res) => {
    res.json({ matches, teams });
});

// =========================================================================
// 5. API PICK/BAN MAP
// =========================================================================
app.post('/api/match/pick-map1', (req, res) => {
    const { userId, matchId, map1, sideA1 } = req.body;
    const match = findMatch(matchId);
    if (!match) return res.status(404).json({ error: 'Trận đấu không tồn tại!' });

    const teamA = findTeam(match.teamA.id);
    if (!teamA || teamA.leaderId !== userId) {
        return res.status(403).json({ error: 'Chỉ Đội Trưởng của Team A mới có quyền thực hiện lượt Pick Map 1!' });
    }

    const sideB1 = sideA1 === 'CT' ? 'TERRORIST' : 'CT';

    match.bo3Maps = [
        { name: map1, pickedBy: match.teamA.id, sideA: sideA1, sideB: sideB1 }
    ];
    match.status = 'PICKING_MAP2';

    res.json({ match });
});

app.post('/api/match/pick-map2', (req, res) => {
    const { userId, matchId, map2, sideB2 } = req.body;
    const match = findMatch(matchId);
    if (!match) return res.status(404).json({ error: 'Trận đấu không tồn tại!' });

    const teamB = findTeam(match.teamB.id);
    if (!teamB || teamB.leaderId !== userId) {
        return res.status(403).json({ error: 'Chỉ Đội Trưởng của Team B mới có quyền thực hiện lượt Pick Map 2!' });
    }

    const sideA2 = sideB2 === 'CT' ? 'TERRORIST' : 'CT';
    const map1Name = match.bo3Maps[0]?.name;

    const remainingMaps = MAP_POOL.filter(m => m !== map1Name && m !== map2);
    const deciderMapName = remainingMaps[Math.floor(Math.random() * remainingMaps.length)] || 'de_dust2';

    match.bo3Maps.push({ name: map2, pickedBy: match.teamB.id, sideA: sideA2, sideB: sideB2 });
    match.bo3Maps.push({ name: deciderMapName, pickedBy: 'DECIDER', sideA: 'CT', sideB: 'TERRORIST' });

    match.status = 'READY';

    res.json({ match });
});

// =========================================================================
// 6. PHỤC VỤ TRANG INDEX.HTML (BỘ DÒ TÌM ĐƯỜNG DẪN TỰ ĐỘNG)
// =========================================================================
app.get('*', (req, res) => {
    const possiblePaths = [
        path.join(__dirname, 'index.html'),
        path.join(__dirname, 'Index.html'),
        path.join(__dirname, 'public', 'index.html'),
        path.join(__dirname, 'src', 'index.html')
    ];

    const foundPath = possiblePaths.find(p => fs.existsSync(p));

    if (foundPath) {
        res.sendFile(foundPath);
    } else {
        res.status(404).send(`
            <div style="font-family: sans-serif; padding: 40px; text-align: center; color: #333;">
                <h2>❌ Không tìm thấy file index.html!</h2>
                <p>Hãy đảm bảo bạn đã push file <b>index.html</b> lên thư mục gốc trên GitHub.</p>
            </div>
        `);
    }
});

// Khởi chạy Server
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` VCT CS 1.6 SERVER DANG CHAY TAI PORT: ${PORT}`);
    console.log(` Tai khoan Admin mac dinh: admin / Mat khau: 123`);
    console.log(`====================================================`);
});