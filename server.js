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

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialDB = { users: [], teams: [], matches: [] };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2));
        return initialDB;
    }
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        return { users: [], teams: [], matches: [] };
    }
}

function saveDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();

if (!db.users.find(u => u.username === 'admin')) {
    db.users.push({
        id: 'ADMIN_001',
        username: 'admin',
        password: bcrypt.hashSync('Hoangh@171112', 10),
        role: 'ADMIN',
        teamId: null,
        token: crypto.randomBytes(10).toString('hex').toUpperCase()
    });
    saveDB(db);
}

function generateToken() {
    return crypto.randomBytes(10).toString('hex').toUpperCase();
}

// --- AUTH APIs ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Thawh tur a kim lo!" });
    if (db.users.find(u => u.username === username)) {
        return res.status(400).json({ error: "Taikhoan a awm sa tawh!" });
    }

    const user = {
        id: Date.now().toString(),
        username,
        password: await bcrypt.hash(password, 10),
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
        return res.status(400).json({ error: "Taikhoan emaw password a dik lo!" });
    }
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role || 'USER', token: user.token, teamId: user.teamId } });
});

// --- TEAM APIs ---
app.get('/api/teams', (req, res) => {
    const fullTeams = db.teams.map(t => ({
        id: t.id,
        name: t.name,
        members: db.users.filter(u => u.teamId === t.id).map(u => u.username),
        wins: t.wins || 0,
        isEliminated: t.isEliminated || false
    }));
    res.json(fullTeams);
});

app.post('/api/team/create', async (req, res) => {
    const { userId, teamName, teamPassword } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (!user || user.teamId) return res.status(400).json({ error: "Team dangah i awm sa tawh!" });

    const team = {
        id: 'TEAM_' + Date.now(),
        name: teamName,
        password: await bcrypt.hash(teamPassword, 10),
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
        return res.status(400).json({ error: "Team chhoh dan a dik lo!" });
    }

    user.teamId = team.id;
    if (!team.members.includes(user.id)) team.members.push(user.id);
    saveDB(db);
    res.json({ success: true, team });
});

// --- DASHBOARD & MATCH APIs ---
app.get('/api/dashboard', (req, res) => {
    res.json({
        teams: db.teams.map(t => ({ id: t.id, name: t.name, memberCount: t.members.length })),
        matches: db.matches
    });
});

app.post('/api/admin/setup-bracket', (req, res) => {
    const { userId, pairings } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin chauhvin tih theih a ni!' });

    db.matches = pairings.map((pair, idx) => {
        const teamA = db.teams.find(t => t.id === pair.teamAId) || { id: 'BYE_A', name: 'BYE' };
        const teamB = db.teams.find(t => t.id === pair.teamBId) || { id: 'BYE_B', name: 'BYE' };

        return {
            id: `M1_R${idx + 1}`,
            round: 1,
            teamA,
            teamB,
            status: 'WAITING',
            currentMapIndex: 0,
            bo3PickState: {
                map1: null, sideA1: 'CT',
                map2: null, sideB2: 'CT',
                map3: null
            },
            bo3Maps: [],
            scoreA: 0,
            scoreB: 0
        };
    });

    saveDB(db);
    res.json({ success: true, matches: db.matches });
});

app.post('/api/admin/start-match', (req, res) => {
    const { userId, matchId } = req.body;
    const user = db.users.find(u => u.id === userId);
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin chauhvin tih theih a ni!' });

    const match = db.matches.find(m => m.id === matchId);
    if (!match) return res.status(404).json({ error: "Trận a awm lo!" });

    match.status = 'PICKING';
    saveDB(db);
    res.json({ success: true, match });
});

// --- TURN-BASED BO3 MAP PICK API ---
app.post('/api/match/submit-bo3', (req, res) => {
    const { userId, matchId, map1, sideA1, map2, sideB2, map3 } = req.body;

    const user = db.users.find(u => u.id === userId);
    const match = db.matches.find(m => m.id === matchId);

    if (!user || !match) return res.status(404).json({ error: "Data a dik lo!" });
    
    const isTeamA = user.teamId === match.teamA.id;
    const isTeamB = user.teamId === match.teamB.id;

    if (!isTeamA && !isTeamB && user.role !== 'ADMIN') {
        return res.status(403).json({ error: "Match chelh tu team i ni lo!" });
    }

    if (map1 === map2 || map2 === map3 || map1 === map3) {
        return res.status(400).json({ error: "Map 3 te hi an inang tur a ni lo!" });
    }

    const finalSideA1 = sideA1 || 'CT';
    const finalSideA2 = (sideB2 === 'CT') ? 'TERRORIST' : 'CT';
    const finalSideA3 = Math.random() < 0.5 ? 'CT' : 'TERRORIST';

    match.bo3Maps = [
        { mapIndex: 1, name: map1, picker: match.teamA.name, sideA: finalSideA1, sideB: finalSideA1 === 'CT' ? 'TERRORIST' : 'CT' },
        { mapIndex: 2, name: map2, picker: match.teamB.name, sideA: finalSideA2, sideB: sideB2 },
        { mapIndex: 3, name: map3, picker: "DECIDER (Random Side)", sideA: finalSideA3, sideB: finalSideA3 === 'CT' ? 'TERRORIST' : 'CT' }
    ];

    match.status = 'READY';
    match.currentMapIndex = 0;
    saveDB(db);

    res.json({ success: true, match });
});

// --- CS 1.6 VERIFICATION API ---
app.get('/api/cs16/verify-player', (req, res) => {
    const { token } = req.query;
    const user = db.users.find(u => u.token === token);
    if (!user) return res.json({ success: false, message: "Token a dik lo!" });

    const team = db.teams.find(t => t.id === user.teamId);
    const activeMatch = db.matches.find(m => 
        (m.teamA.id === user.teamId || m.teamB.id === user.teamId) && 
        (m.status === 'READY' || m.status === 'PICKING')
    );

    if (!activeMatch || activeMatch.bo3Maps.length === 0) {
        return res.json({
            success: true,
            username: user.username,
            role: user.role || 'USER',
            teamName: team ? team.name : "Team a awm lo",
            isPlaying: false
        });
    }

    const currentMapInfo = activeMatch.bo3Maps[activeMatch.currentMapIndex] || activeMatch.bo3Maps[0];
    const isTeamA = activeMatch.teamA.id === user.teamId;
    const playerSide = isTeamA ? currentMapInfo.sideA : currentMapInfo.sideB;

    const teamAMembers = db.users.filter(u => u.teamId === activeMatch.teamA.id).map(u => u.username);
    const teamBMembers = db.users.filter(u => u.teamId === activeMatch.teamB.id).map(u => u.username);

    res.json({
        success: true,
        username: user.username,
        role: user.role || 'USER',
        teamId: user.teamId,
        teamName: team ? team.name : "Team a awm lo",
        isPlaying: true,
        matchInfo: {
            matchId: activeMatch.id,
            currentMapNumber: activeMatch.currentMapIndex + 1,
            map: currentMapInfo.name,
            picker: currentMapInfo.picker,
            assignedSide: playerSide,
            teamA: { id: activeMatch.teamA.id, name: activeMatch.teamA.name, members: teamAMembers, side: currentMapInfo.sideA },
            teamB: { id: activeMatch.teamB.id, name: activeMatch.teamB.name, members: teamBMembers, side: currentMapInfo.sideB }
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VCT BO3 Server running on port ${PORT}`));