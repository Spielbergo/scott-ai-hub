/**
 * functions/index.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Scott AI Hub — Firebase Cloud Functions entry point.
 *
 * Registers all agent functions for deployment.
 * Add future agents here as additional exports.
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const admin = require("firebase-admin");

// Initialise Admin SDK once at module load (idempotent)
if (!admin.apps.length) {
  admin.initializeApp();
}

// ── Agent 1: Market Trend Data Analyst ───────────────────────────────────────
const { marketTrendScheduled, marketTrendHttp } = require("./agents/marketTrendAnalyst");

exports.marketTrendScheduled = marketTrendScheduled;
exports.marketTrendHttp = marketTrendHttp;

// ── Future agents will be added here ─────────────────────────────────────────
// const { mlsCoordinator }       = require("./agents/mlsCoordinator");
// const { socialMediaDirector }  = require("./agents/socialMediaDirector");
// const { editorialWriter }      = require("./agents/editorialWriter");
// const { houseWorthSpecialist } = require("./agents/houseWorthSpecialist");
// exports.mlsCoordinator       = mlsCoordinator;
// exports.socialMediaDirector  = socialMediaDirector;
// exports.editorialWriter      = editorialWriter;
// exports.houseWorthSpecialist = houseWorthSpecialist;
