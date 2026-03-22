import { expect } from 'chai';
import { GradingDepartment, SystemGradeReport } from '../../src/agent/grading-department';

describe('Grading Department', () => {
  let grader: GradingDepartment;

  beforeEach(() => {
    grader = new GradingDepartment();
  });

  it('should generate a report with all 5 departments', () => {
    const report = grader.generateReport();
    expect(report).to.have.property('departments');
    expect(report.departments).to.have.length(5);

    const names = report.departments.map(d => d.name);
    expect(names).to.include('Strategies');
    expect(names).to.include('Instinct');
    expect(names).to.include('Immune');
    expect(names).to.include('Evolution');
    expect(names).to.include('Frontier');
  });

  it('should have valid scores (0-100) for all departments', () => {
    const report = grader.generateReport();
    for (const dept of report.departments) {
      expect(dept.score).to.be.at.least(0);
      expect(dept.score).to.be.at.most(100);
    }
  });

  it('should have valid letter grades', () => {
    const report = grader.generateReport();
    const validGrades = ['A', 'B', 'C', 'D', 'F'];
    for (const dept of report.departments) {
      expect(validGrades).to.include(dept.letter);
    }
    expect(validGrades).to.include(report.overallLetter);
  });

  it('should have a valid overall GPA (0-4.0)', () => {
    const report = grader.generateReport();
    expect(report.overallGPA).to.be.at.least(0);
    expect(report.overallGPA).to.be.at.most(4.0);
  });

  it('should have a valid overall score (0-100)', () => {
    const report = grader.generateReport();
    expect(report.overallScore).to.be.at.least(0);
    expect(report.overallScore).to.be.at.most(100);
  });

  it('should generate evolution context string', () => {
    const context = grader.getEvolutionContext();
    expect(context).to.be.a('string');
    expect(context).to.include('System Grade Report');
    expect(context).to.include('PRIORITY');
  });

  it('should handle missing state files gracefully', () => {
    // Even with no data files, should return default grades without throwing
    const report = grader.generateReport();
    expect(report).to.have.property('departments');
    expect(report.departments.length).to.equal(5);
    // All should default to C/50 when no data
    for (const dept of report.departments) {
      expect(dept.score).to.be.at.least(0);
    }
  });

  it('should include generatedAt timestamp', () => {
    const report = grader.generateReport();
    expect(report.generatedAt).to.be.a('number');
    expect(report.generatedAt).to.be.greaterThan(0);
    // Should be recent (within last minute)
    expect(Date.now() - report.generatedAt).to.be.lessThan(60_000);
  });
});
