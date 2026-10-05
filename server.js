const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const DB_FILE = path.join(__dirname, 'db.json');

// Hàm đọc dữ liệu từ file db.json
function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialDB = { users: [], teams: [], matches: [] };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2));
        return initialDB;
    }
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { users: [], teams: [], matches: [] };
    }
}

// Hàm ghi dữ liệu xuống file db.json
function saveDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();

// Khởi tạo Admin mặc định nếu chưa có (admin / admin123)
if (!db.users.find(u => u.username === 'admin')) {
    const adminPasswordHash = bcrypt.hashSync('Hoangh@171112', 10);
    db.users.push({
        id: 'ADMIN_001',
        username: 'admin',
        password: adminPasswordHash,
        role: 'ADMIN',
        teamId: null,
        token: crypto.randomBytes(10).toString('hex').toUpperCase()
    });
    saveDB(db);
}

const mapPool = ["de_dust2", "de_inferno", "de_nuke", "de_train", "de_aztec", "de_cbble", "de_prodigy"];

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
    saveDB(db);
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
    if (!user || user.teamId) return res.status(400).json({ error: "Thao tác không hợp lệ hoặc đã thuộc team khác!" });

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
    saveDB(db);
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
    saveDB(db);
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
    saveDB(db);

    res.json({ success: true, message: 'Đã giải tán team thành công!' });
});

// --- DASHBOARD & BRACKET SETUP APIs ---
app.get('/api/dashboard', (req, res) => {
    res.json({
        teams: db.teams.map(t => ({ id: t.id, name: t.name, memberCount: t.members.length })),
        matches: db.matches
    });
});

// Admin Xếp Cặp Đấu Vòng 1
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
            sideA: 'CT',
            status: 'WAITING', // WAITING -> PICKING (Khi Admin cho bắt đầu) -> READY -> FINISHED
            scoreA: 0,
            scoreB: 0
        };
    });

    saveDB(db);
    res.json({ success: true, matches: db.matches });
});

// Admin Cho Bắt Đầu Trận
app.post('/api/admin/start-match', (req, res) => {
    const { userId, matchId } = req.body;
    const user = db.users.find(u => u.id === userId);

    if (!user || user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Chỉ Admin mới có quyền bắt đầu trận đấu!' });
    }

    const match = db.matches.find(m => m.id === matchId);
    if (!match) return res.status(404).json({ error: "Không tìm thấy trận đấu!" });

    match.status = 'PICKING'; // Chuyển trạng thái sang cho phép 2 team Pick Map
    saveDB(db);

    res.json({ success: true, match });
});

// Pick Map & Chọn Phe (Chỉ cho 2 team trong trận đấu)
app.post('/api/match/select-map', (req, res) => {
    const { userId, matchId, mapName, chosenSideA } = req.body; 

    const user = db.users.find(u => u.id === userId);
    const match = db.matches.find(m => m.id === matchId);

    if (!user || !match) return res.status(404).json({ error: "Dữ liệu không hợp lệ!" });

    // Kiểm tra user có thuộc 1 trong 2 team đang đấu hay không
    if (user.teamId !== match.teamA.id && user.teamId !== match.teamB.id) {
        return res.status(403).json({ error: "Bạn không thuộc 2 đội đang thi đấu trận này!" });
    }

    if (match.status !== 'PICKING') {
        return res.status(400).json({ error: "Trận đấu chưa được Admin bắt đầu hoặc đã chốt xong!" });
    }

    match.pickedMap = mapName;
    match.sideA = chosenSideA || 'CT';
    match.status = 'READY'; // Sẵn sàng thi đấu trong CS 1.6
    saveDB(db);

    res.json({ success: true, match });
});

// --- CS 1.6 VERIFICATION API ---
app.get('/api/cs16/verify-player', (req, res) => {
    const { token } = req.query;
    const user = db.users.find(u => u.token === token);
    if (!user) return res.json({ success: false, message: "Mã Token không hợp lệ!" });

    const team = db.teams.find(t => t.id === user.teamId);
    const activeMatch = db.matches.find(m => 
        (m.teamA.id === user.teamId || m.teamB.id === user.teamId) && 
        (m.status === 'READY' || m.status === 'PICKING')
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
    const playerSide = isTeamA ? activeMatch.sideA : (activeMatch.sideA === 'CT' ? 'TERRORIST' : 'CT');

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
            assignedSide: playerSide,
            teamA: { id: activeMatch.teamA.id, name: activeMatch.teamA.name, members: teamAMembers, startSide: activeMatch.sideA },
            teamB: { id: activeMatch.teamB.id, name: activeMatch.teamB.name, members: teamBMembers, startSide: activeMatch.sideA === 'CT' ? 'TERRORIST' : 'CT' }
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VCT Server running on port ${PORT}`));