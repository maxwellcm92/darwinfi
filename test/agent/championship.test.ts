import { Championship } from '../../src/agent/championship';
import { PerformanceTracker } from '../../src/agent/performance';
import { expect } from 'chai';

describe('Championship', () => {
  let tracker: PerformanceTracker;
  let championship: Championship;

  beforeEach(() => {
    tracker = new PerformanceTracker();
    championship = new Championship(tracker);
  });

  // ---------- Missing managers ----------

  describe('Missing managers', () => {
    it('should return empty champions when no managers are set', () => {
      const champions = championship.getChampions();
      expect(champions).to.be.an('array').that.is.empty;
    });

    it('should return null overall champion when no managers are set', () => {
      const champ = championship.getOverallChampion();
      expect(champ).to.be.null;
    });

    it('should handle evaluation gracefully with no managers', () => {
      const standings = championship.evaluateChampionship();
      expect(standings.champions).to.be.an('array').that.is.empty;
      expect(standings.overallChampion).to.be.null;
      expect(standings.evaluationCount).to.equal(1);
    });
  });

  // ---------- getOverallChampion eligibility ----------

  describe('getOverallChampion eligibility', () => {
    it('should require at least 5 trades to be eligible', () => {
      // No managers, no trades -- null champion
      const champ = championship.getOverallChampion();
      expect(champ).to.be.null;
    });
  });

  // ---------- evaluateChampionship ----------

  describe('evaluateChampionship', () => {
    it('should increment evaluationCount on each call', () => {
      expect(championship.getEvaluationCount()).to.equal(0);

      championship.evaluateChampionship();
      expect(championship.getEvaluationCount()).to.equal(1);

      championship.evaluateChampionship();
      expect(championship.getEvaluationCount()).to.equal(2);
    });

    it('should include a timestamp in standings', () => {
      const standings = championship.evaluateChampionship();
      expect(standings.timestamp).to.be.a('string');
      // Verify it's a valid ISO string
      expect(new Date(standings.timestamp).toISOString()).to.equal(standings.timestamp);
    });

    it('should store last standings', () => {
      expect(championship.getLastStandings()).to.be.null;

      const standings = championship.evaluateChampionship();
      expect(championship.getLastStandings()).to.deep.equal(standings);
    });
  });

  // ---------- With FrontierManager ----------

  describe('With FrontierManager integration', () => {
    it('should accept setFrontierManager without error', () => {
      // Create a minimal mock frontier manager
      const mockFrontierManager = {
        getTeamWinner: () => null,
        getBot: () => undefined,
        getAllBots: () => [],
      } as any;

      expect(() => championship.setFrontierManager(mockFrontierManager)).to.not.throw();
    });

    it('should accept setStrategyManager without error', () => {
      const mockStrategyManager = {
        getMainStrategies: () => [],
      } as any;

      expect(() => championship.setStrategyManager(mockStrategyManager)).to.not.throw();
    });
  });

  // ---------- Full cycle with mock managers ----------

  describe('Full cycle with mock managers', () => {
    it('should gather champions from both managers when set', () => {
      // Mock strategy manager with one main strategy
      tracker.initStrategy('main-alpha');
      const mockStrategyManager = {
        getMainStrategies: () => [
          { id: 'main-alpha', name: 'Apex', type: 'main', parameters: {}, status: 'paper', generation: 0 },
        ],
      } as any;

      // Mock frontier manager with no winner
      const mockFrontierManager = {
        getTeamWinner: () => null,
        getBot: () => undefined,
      } as any;

      championship.setStrategyManager(mockStrategyManager);
      championship.setFrontierManager(mockFrontierManager);

      const champions = championship.getChampions();
      // Should have at least 1 from strategy manager (main-alpha = Team 1)
      expect(champions.length).to.be.gte(1);
      expect(champions[0].teamName).to.equal('Apex');
      expect(champions[0].strategyId).to.equal('main-alpha');
    });
  });
});
