const { Op } = require('sequelize');

const PUBLISHED_STATUSES = Object.freeze(['published', 'active']);
const HIDDEN_STATUSES = Object.freeze(['draft', 'hidden', 'archived', 'cancelled', 'deleted']);

const normalizedStatus = (value) => String(value || '').trim().toLowerCase();
const isPublishedStatus = (value) => PUBLISHED_STATUSES.includes(normalizedStatus(value));
const isStudentVisibleTopic = (topic) => Boolean(topic && !topic.deletedAt && isPublishedStatus(topic.status));
const isStudentVisibleLesson = (lesson) => Boolean(
  lesson && !lesson.deletedAt
  && !HIDDEN_STATUSES.includes(normalizedStatus(lesson.status))
  && (lesson.isPublished === true || isPublishedStatus(lesson.status))
);
const studentVisibleTopicWhere = (courseId) => ({ courseId, status: { [Op.in]: PUBLISHED_STATUSES } });
const studentVisibleLessonWhere = () => ({
  [Op.and]: [
    { status: { [Op.notIn]: HIDDEN_STATUSES } },
    { [Op.or]: [{ status: { [Op.in]: PUBLISHED_STATUSES } }, { isPublished: true }] }
  ]
});

module.exports = {
  HIDDEN_STATUSES, PUBLISHED_STATUSES, isPublishedStatus, isStudentVisibleLesson,
  isStudentVisibleTopic, studentVisibleLessonWhere, studentVisibleTopicWhere
};
