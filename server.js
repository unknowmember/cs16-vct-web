const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Database bộ nhớ RAM
const db = {
    users: [],       // { id, username, password, role, teamId, token }
    teams: [],       // { id, name, password, members: [], wins: 0, isEliminated: false }
    matches: [],     // { id, round, teamA, teamB, pickedMap, pickType, sideA, status, scoreA, scoreB }
    mapPool: ["de_dust2", "de_inferno", "de_nuke", "de_train", "de_aztec", "de_cbble", "de_prodigy"]
};

// Tài khoản Admin mặc định: admin / admin123
const adminPasswordHash = bcrypt.hashSync('Hoangh@171112', 10);
db.users.push({
    id: 'ADMIN_001',
    username: 'admin',
    password: adminPasswordHash,
    role: 'ADMIN',
    teamId: null,
    token: crypto.randomBytes(10).toString('hex').toUpperCase()
});

function generateToken() {
    return crypto.randomBytes(10).toString('hex').toUpperCase();
}

// --- AUTH APIs ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Thiếu thông tin!" });
    if (db.users.find(u => u.username === username)) {
        return res.status(400).json({ error: "Tài khoản đã tồn tại!" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
        id: Date.now().toString(),
        username,
        password: hashedPassword,
        role: 'USER',
        teamId: null,
        token: generateToken()
    };
    
    db.users.push(user);
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, token: user.token, teamId: null } });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = db.users.find(u => u.username === username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ error: "Sai tài khoản hoặc mật khẩu!" });
    }
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role || 'USER', token: user.token, teamId: user.teamId } });
});

// --- TEAM APIs ---
app.get('/api/teams', (req, res) => {
    const fullTeams = db.teams.map(t => {
        const memberUsernames = db.users
            .filter(u => u.teamId === t.id)
            .map(u => u.username);

        return {
            id: t.id,
            name: t.name,
            members: memberUsernames,
            wins: t.wins || 0,
            isEliminated: t.isEliminated || false
        };
    });
    res.json(fullTeams);
});

app.post('/api/team/create', async (req, res) => {
    const { userId, teamName, teamPassword } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (!user || user.teamId) return res.status(400).json({ error: "Thao tác không hợp lệ hoặc đã có team!" });

    const hashedPassword = await bcrypt.hash(teamPassword, 10);
    const team = {
        id: 'TEAM_' + Date.now(),
        name: teamName,
        password: hashedPassword,
        members: [user.id],
        wins: 0,
        isEliminated: false
    };

    db.teams.push(team);
    user.teamId = team.id;
    res.json({ success: true, team });
});

app.post('/api/team/join', async (req, res) => {
    const { userId, teamName, teamPassword } = req.body;
    const user = db.users.find(u => u.id === userId);
    const team = db.teams.find(t => t.name === teamName);
    if (!user || !team || !(await bcrypt.compare(teamPassword, team.password))) {
        return res.status(400).json({ error: "Thông tin gia nhập Team không đúng!" });
    }

    user.teamId = team.id;
    if (!team.members.includes(user.id)) team.members.push(user.id);
    res.json({ success: true, team });
});

app.post('/api/admin/delete-team', (req, res) => {
    const { userId, teamId } = req.body;
    const user = db.users.find(u => u.id === userId);

    if (!user || user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Chỉ Admin mới có quyền giải tán team!' });
    }

    db.teams = db.teams.filter(t => t.id !== teamId);
    db.users.forEach(u => { if (u.teamId === teamId) u.teamId = null; });

    res.json({ success: true, message: 'Đã giải tán team thành công!' });
});

// --- DASHBOARD & BRACKET SETUP APIs ---
app.get('/api/dashboard', (req, res) => {
    res.json({
        teams: db.teams.map(t => ({ id: t.id, name: t.name, memberCount: t.members.length })),
        matches: db.matches
    });
});

// Admin xếp cặp đấu Vòng 1
app.post('/api/admin/setup-bracket', (req, res) => {
    const { userId, pairings } = req.body;
    const user = db.users.find(u => u.id === userId);

    if (!user || user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Chỉ Admin mới có quyền xếp cặp đấu!' });
    }

    db.matches = pairings.map((pair, idx) => {
        const teamA = db.teams.find(t => t.id === pair.teamAId) || { id: 'BYE_A', name: 'Miễn đấu (BYE)' };
        const teamB = db.teams.find(t => t.id === pair.teamBId) || { id: 'BYE_B', name: 'Miễn đấu (BYE)' };

        return {
            id: `M1_R${idx + 1}`,
            round: 1,
            teamA,
            teamB,
            pickedMap: null,
            pickType: null,   // 'PICK' hoặc 'DECIDER'
            sideA: 'CT',       // 'CT' hoặc 'TERRORIST'
            status: 'PENDING', // 'PENDING', 'READY', 'FINISHED'
            scoreA: 0,
            scoreB: 0
        };
    });

    res.json({ success: true, matches: db.matches });
});

// Pick Map & Chọn Phe / Random Phe
app.post('/api/match/select-map', (req, res) => {
    const { matchId, mapName, pickType, chosenSideA } = req.body; 
    // pickType: 'PICK' hoặc 'DECIDER'
    // chosenSideA: 'CT' hoặc 'TERRORIST' (Nếu là PICK)

    const match = db.matches.find(m => m.id === matchId);
    if (!match) return res.status(404).json({ error: "Không tìm thấy trận đấu!" });

    match.pickedMap = mapName;
    match.pickType = pickType;

    if (pickType === 'PICK') {
        // Nếu là Map Pick -> Dùng phe xuất phát do người chọn quyết định
        match.sideA = chosenSideA || 'CT';
    } else if (pickType === 'DECIDER') {
        // Nếu là Map Decider -> Random ngẫu nhiên phe xuất phát
        match.sideA = Math.random() < 0.5 ? 'CT' : 'TERRORIST';
    }

    match.status = 'READY';
    res.json({ success: true, match });
});

// --- CS 1.6 VERIFICATION API (Giữ nguyên phân chia Team cho Server Game) ---
app.get('/api/cs16/verify-player', (req, res) => {
    const { token } = req.query;
    const user = db.users.find(u => u.token === token);
    if (!user) return res.json({ success: false, message: "Mã Token không hợp lệ!" });

    const team = db.teams.find(t => t.id === user.teamId);
    const activeMatch = db.matches.find(m => 
        (m.teamA.id === user.teamId || m.teamB.id === user.teamId) && 
        (m.status === 'READY' || m.status === 'PENDING')
    );

    if (!activeMatch) {
        return res.json({
            success: true,
            username: user.username,
            role: user.role || 'USER',
            teamName: team ? team.name : "Chưa có team",
            isPlaying: false
        });
    }

    const isTeamA = activeMatch.teamA.id === user.teamId;
    
    // Tính toán phe xuất phát chính xác từng người chơi
    // Nếu SideA là 'CT' -> Team A đóng vai CT, Team B đóng vai TERRORIST (và ngược lại)
    const playerSide = isTeamA ? activeMatch.sideA : (activeMatch.sideA === 'CT' ? 'TERRORIST' : 'CT');

    // Lấy toàn bộ danh sách tài khoản thuộc Team A và Team B để Server CS 1.6 chia đội chính xác
    const teamAMembers = db.users.filter(u => u.teamId === activeMatch.teamA.id).map(u => u.username);
    const teamBMembers = db.users.filter(u => u.teamId === activeMatch.teamB.id).map(u => u.username);

    res.json({
        success: true,
        username: user.username,
        role: user.role || 'USER',
        teamId: user.teamId,
        teamName: team ? team.name : "Chưa có team",
        isPlaying: true,
        matchInfo: {
            matchId: activeMatch.id,
            map: activeMatch.pickedMap || "de_dust2",
            pickType: activeMatch.pickType,
            assignedSide: playerSide, // 'CT' hoặc 'TERRORIST' cho đúng người dùng này
            teamA: { id: activeMatch.teamA.id, name: activeMatch.teamA.name, members: teamAMembers, startSide: activeMatch.sideA },
            teamB: { id: activeMatch.teamB.id, name: activeMatch.teamB.name, members: teamBMembers, startSide: activeMatch.sideA === 'CT' ? 'TERRORIST' : 'CT' }
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VCT Server running on port ${PORT}`));