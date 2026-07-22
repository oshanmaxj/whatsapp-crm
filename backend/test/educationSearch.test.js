const test = require('node:test');
const assert = require('node:assert/strict');
const models = require('../src/models');
const education = require('../src/services/education.service');
const portal = require('../src/services/studentPortal.service');
const searchIndexesMigration = require('../migrations/041_education_search_indexes');

test('student search is paginated and exposes only selector fields', async () => {
  const original = models.Student.findAndCountAll;
  let options;
  try {
    models.Student.findAndCountAll = async (value) => { options = value; return { count: 21, rows: [{ id: 1, studentNo: 'STU-101934', name: 'Kanchana', phone: '94750954981' }] }; };
    const result = await education.searchStudents({ q: '101934', page: 2, limit: 10 });
    assert.equal(result.page, 2);
    assert.equal(result.hasMore, true);
    assert.deepEqual(options.attributes, ['id', 'studentNo', 'name', 'phone', 'email', 'status']);
    assert.equal(options.offset, 10);
    assert.ok(!options.attributes.includes('portalPasswordHash'));
  } finally { models.Student.findAndCountAll = original; }
});

test('course and batch selectors use server-side pagination', async () => {
  const originals = { course: models.Course.findAndCountAll, batch: models.Batch.findAndCountAll };
  try {
    models.Course.findAndCountAll = async (options) => ({ count: 1, rows: [{ id: 2, code: 'TML130', name: 'Trading Master' }] });
    models.Batch.findAndCountAll = async (options) => ({ count: 1, rows: [{ id: 3, code: 'B130', name: 'July' }] });
    const courses = await education.searchCourses({ q: 'TML', page: 1, limit: 20 });
    const batches = await education.searchBatches({ q: 'B130', courseId: 2, page: 1, limit: 20 });
    assert.equal(courses.items[0].code, 'TML130');
    assert.equal(batches.items[0].code, 'B130');
  } finally { models.Course.findAndCountAll = originals.course; models.Batch.findAndCountAll = originals.batch; }
});

test('fee search forwards course, batch, status and pagination to the database', async () => {
  const original = models.StudentFee.findAndCountAll;
  let options;
  try {
    models.StudentFee.findAndCountAll = async (value) => { options = value; return { count: 25, rows: [] }; };
    const result = await education.listFees({ q: 'STU-1', courseId: 2, batchId: 3, status: 'partial', page: 2, limit: 10 });
    assert.equal(options.where.courseId, 2);
    assert.equal(options.where.batchId, 3);
    assert.equal(options.where.status, 'partial');
    assert.equal(options.offset, 10);
    assert.equal(result.total, 25);
  } finally { models.StudentFee.findAndCountAll = original; }
});

test('student curriculum returns every sorted topic, zero-lesson topics, and no duplicate lessons', async () => {
  const originals = { course: models.Course.findByPk, topics: models.LmsTopic.findAll, enrollments: portal.activeEnrollments };
  try {
    portal.activeEnrollments = async () => [{ id: 7, courseId: 16, batchId: null, enrolledAt: new Date('2026-01-01') }];
    models.Course.findByPk = async () => ({ lmsStatus: 'published', dripEnabled: false, toJSON: () => ({ id: 16, name: 'Trading Master' }) });
    const lesson = { id: 201, topicId: 101, title: 'Lesson', status: 'published', sortOrder: 1, progress: [{ isCompleted: true }], batchOverrides: [] };
    models.LmsTopic.findAll = async () => [
      { toJSON: () => ({ id: 101, title: 'First', sortOrder: 1, lessons: [lesson, lesson] }) },
      { toJSON: () => ({ id: 102, title: 'Second', sortOrder: 2, lessons: [] }) }
    ];
    const result = await portal.courseCurriculum({ id: 9 }, 16, { enrollments: [{ enrollmentId: 7, allowed: true }] });
    assert.deepEqual(result.topics.map((topic) => topic.id), [101, 102]);
    assert.equal(result.topics[0].lessons.length, 1);
    assert.equal(result.topics[1].lessons.length, 0);
    assert.equal(result.progress.totalLessons, 1);
    assert.equal(result.course.topics.length, 2);
  } finally { models.Course.findByPk = originals.course; models.LmsTopic.findAll = originals.topics; portal.activeEnrollments = originals.enrollments; }
});

test('course access returns more than three topics and all eligible lessons in stable order', async () => {
  const originals = { course: models.Course.findByPk, topics: models.LmsTopic.findAll, enrollments: portal.activeEnrollments };
  try {
    portal.activeEnrollments = async () => [{ id: 7, courseId: 16, batchId: null, enrolledAt: new Date('2026-01-01') }];
    models.Course.findByPk = async () => ({ lmsStatus: 'published', dripEnabled: true, toJSON: () => ({ id: 16, name: 'Course' }) });
    const row=(id,sortOrder,lessons)=>({toJSON:()=>({id,title:`Topic ${id}`,sortOrder,lessons})});
    const lesson=(id,sortOrder,extra={})=>({id,topicId:1,title:`Lesson ${id}`,status:'published',isPublished:true,sortOrder,progress:[],batchOverrides:[],...extra});
    models.LmsTopic.findAll=async()=>[
      row(4,4,[lesson(42,2),lesson(41,1)]),row(2,2,[lesson(20,0)]),row(1,1,[lesson(10,0)]),
      row(3,3,[lesson(30,0),lesson(31,1)]),row(5,5,[lesson(50,0,{dripType:'specific_date',dripReleaseAt:new Date(Date.now()+86400000)})])
    ];
    const result=await portal.courseCurriculum({id:9},16,{enrollments:[{enrollmentId:7,allowed:true}]});
    assert.deepEqual(result.topics.map(topic=>topic.id),[1,2,3,4,5]);
    assert.deepEqual(result.topics[3].lessons.map(item=>item.id),[41,42]);
    assert.equal(result.topics[4].lessons.length,0,'future scheduled lesson stays hidden');
    assert.equal(result.topics.flatMap(topic=>topic.lessons).length,6);
  } finally { models.Course.findByPk=originals.course; models.LmsTopic.findAll=originals.topics; portal.activeEnrollments=originals.enrollments; }
});

test('Education search index migration is additive and idempotent', async () => {
  const indexes = new Map();
  const queryInterface = {
    sequelize: { transaction: async (callback) => callback({}), getDialect: () => 'sqlite' },
    showIndex: async (table) => indexes.get(table) || [],
    addIndex: async (table, fields, options) => indexes.set(table, [...(indexes.get(table) || []), { name: options.name, fields }])
  };
  await searchIndexesMigration.up(queryInterface);
  const firstCount = [...indexes.values()].reduce((sum, rows) => sum + rows.length, 0);
  await searchIndexesMigration.up(queryInterface);
  const secondCount = [...indexes.values()].reduce((sum, rows) => sum + rows.length, 0);
  assert.equal(firstCount, 11);
  assert.equal(secondCount, firstCount);
});
