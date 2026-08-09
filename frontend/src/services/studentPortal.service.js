import axios from 'axios';
import { API_BASE_URL } from '../config/apiConfig';

const portalApi = axios.create({ baseURL: API_BASE_URL });
portalApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('studentPortalToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
portalApi.interceptors.response.use((response) => response, (error) => {
  if (error.response?.status === 401 && window.location.pathname !== '/student/login') {
    localStorage.removeItem('studentPortalToken');
    window.location.assign('/student/login');
  }
  return Promise.reject(error);
});

export const studentLogin = (payload) => portalApi.post('/student-portal/login', payload);
export const verifyStudentOtp = (payload) => portalApi.post('/student-portal/verify-otp', payload);
export const getStudentMe = () => portalApi.get('/student-portal/me');
export const getStudentDashboard = () => portalApi.get('/student-portal/dashboard');
export const getStudentMyCourses = () => portalApi.get('/student-portal/my-courses');
export const getStudentCourse = (courseId) => portalApi.get(`/lms/student/courses/${courseId}`);
export const getStudentUpcomingClasses = () => portalApi.get('/student-portal/upcoming-classes');
export const getStudentLiveClasses = () => portalApi.get('/student-portal/live-classes');
export const getStudentLessons = () => portalApi.get('/student-portal/lessons');
export const getStudentMaterials = () => portalApi.get('/student-portal/materials');
export const getStudentLesson = (id) => portalApi.get(`/student-portal/lessons/${id}`);
export const addStudentLessonComment = (id, payload) => portalApi.post(`/student-portal/lessons/${id}/comments`, payload);
export const updateStudentProgress = (id, payload) => portalApi.post(`/student-portal/lessons/${id}/progress`, payload);
export const joinStudentLiveClass = (id) => portalApi.post(`/student-portal/lessons/${id}/join-live-class`);
export const getStudentPayments = () => portalApi.get('/student-portal/payments');
export const getStudentSupportCategories = () => portalApi.get('/student-portal/support/categories');
export const listStudentSupportTickets = (params = {}) => portalApi.get('/student-portal/support/tickets', { params });
export const createStudentSupportTicket = (payload) => portalApi.post('/student-portal/support/tickets', payload);
export const getStudentSupportTicket = (id) => portalApi.get(`/student-portal/support/tickets/${id}`);
export const replyStudentSupportTicket = (id, body) => portalApi.post(`/student-portal/support/tickets/${id}/replies`, { body });
export const confirmStudentSupportTicket = (id) => portalApi.post(`/student-portal/support/tickets/${id}/confirm-resolved`);
