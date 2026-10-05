const express = require('express');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

let tournamentData = {
    teams: [],
    mapPool: ["de_dust2", "de_inferno", "de_nuke", "de_train", "de_aztec", "de_cbble", "de_prodigy"],
    upperBracket: [],
    lowerBracket: [],
    activeMatch: {
        teamA: "Team Alpha",
        teamB: "Team Beta",
        map: "de_dust2",
        sideA: "CT",
        status: "WAITING"
    }
};

app.get('/api/tournament', (req, res) => res.json(tournamentData));

app.post('/api/tournament/setup', (req, res) => {
    const { teams } = req.body;
    tournamentData.teams = teams;
    tournamentData.upperBracket = [];
    for (let i = 0; i < teams.length; i += 2) {
        tournamentData.upperBracket.push({
            id: `UB_R1_M${Math.floor(i/2) + 1}`,
            team1: teams[i] || "BYE",
            team2: teams[i+1] || "BYE",
            winner: null
        });
    }
    res.json({ success: true, tournamentData });
});

app.post('/api/match/set-active', (req, res) => {
    const { teamA, teamB, map, sideA } = req.body;
    tournamentData.activeMatch = { teamA, teamB, map, sideA: sideA || "CT", status: "READY" };
    res.json({ success: true, activeMatch: tournamentData.activeMatch });
});

app.get('/api/cs16/get-match', (req, res) => res.json(tournamentData.activeMatch));

app.post('/api/cs16/update-result', (req, res) => {
    const { winnerTeam, scoreA, scoreB } = req.body;
    tournamentData.activeMatch.status = "FINISHED";
    tournamentData.activeMatch.winner = winnerTeam;
    tournamentData.activeMatch.score = `${scoreA}-${scoreB}`;
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));