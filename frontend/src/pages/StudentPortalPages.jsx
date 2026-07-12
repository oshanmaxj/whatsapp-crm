import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Alert, AppBar, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress,
  Container, Divider, LinearProgress, MenuItem, Paper, Stack, TextField, Toolbar, Typography
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import PaymentsIcon from '@mui/icons-material/Payments';
import PersonIcon from '@mui/icons-material/Person';
import SchoolIcon from '@mui/icons-material/School';
import VideoCallIcon from '@mui/icons-material/VideoCall';
import FolderCopyIcon from '@mui/icons-material/FolderCopy';
import DownloadIcon from '@mui/icons-material/Download';
import {
  addStudentLessonComment, getStudentDashboard, getStudentLesson, getStudentLessons, getStudentMaterials,
  getStudentMe, getStudentPayments, joinStudentLiveClass, studentLogin, updateStudentProgress, verifyStudentOtp
} from '../services/studentPortal.service';
import { API_ORIGIN } from '../config/apiConfig';

const paymentWarning = 'Your LMS access is temporarily disabled due to pending payment. Please contact the office.';
const assetUrl = (value) => String(value || '').startsWith('/uploads/') ? `${API_ORIGIN}${value}` : value;

function saveSession(data) {
  localStorage.setItem('studentPortalToken', data.token);
}

export function StudentLoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('password');
  const [form, setForm] = useState({ identifier: '', password: '', otp: '' });
  const [challenge, setChallenge] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  useEffect(() => {
    if (resendSeconds <= 0) return undefined;
    const timer = setInterval(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendSeconds]);
  if (localStorage.getItem('studentPortalToken')) return <Navigate to="/student/dashboard" replace />;

  const submit = async () => {
    try {
      setBusy(true); setError(''); setNotice('');
      const response = await studentLogin({ identifier: form.identifier, password: mode === 'password' ? form.password : undefined, method: mode });
      const data = response.data.data;
      if (data.token) { saveSession(data); navigate('/student/dashboard'); return; }
      setChallenge(data.challengeToken);
      setResendSeconds(Number(data.resendAfterSeconds || 60));
      setNotice('If the account details are valid, a WhatsApp code has been sent.');
    } catch (requestError) {
      const code = requestError.response?.data?.code;
      setError(code === 'OTP_RATE_LIMITED' ? 'Please wait before requesting another code.' : 'Unable to send a code. Check your details or try again later.');
    } finally { setBusy(false); }
  };
  const verify = async () => {
    try {
      setBusy(true); setError('');
      const response = await verifyStudentOtp({ challengeToken: challenge, otp: form.otp });
      saveSession(response.data.data);
      navigate('/student/dashboard');
    } catch (requestError) { setError(requestError.response?.data?.message || 'Unable to verify OTP.'); }
    finally { setBusy(false); }
  };

  return <Box sx={{ minHeight: '100vh', bgcolor: '#f3f8f5', display: 'grid', placeItems: 'center', p: 2 }}>
    <Paper variant="outlined" sx={{ width: '100%', maxWidth: 440, p: { xs: 2.5, sm: 4 }, borderRadius: 3 }}>
      <Stack spacing={2.5}>
        <Box textAlign="center"><SchoolIcon color="primary" sx={{ fontSize: 48 }} /><Typography variant="h4" fontWeight={900}>Student Portal</Typography><Typography color="text.secondary">Classes, recordings, materials, and progress</Typography></Box>
        {notice && <Alert severity="info">{notice}</Alert>}{error && <Alert severity="error">{error}</Alert>}
        {!challenge ? <>
          <TextField label="Phone, registration number, or email" value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} autoFocus fullWidth />
          {mode === 'password' && <TextField type="password" label="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} fullWidth />}
          <Button variant="contained" size="large" onClick={submit} disabled={busy || !form.identifier}>{busy ? <CircularProgress size={22} /> : mode === 'otp' ? 'Send WhatsApp OTP' : 'Sign in'}</Button>
          <Button onClick={() => setMode(mode === 'otp' ? 'password' : 'otp')}>{mode === 'otp' ? 'Use password instead' : 'Use WhatsApp OTP instead'}</Button>
        </> : <>
          <TextField label="6-digit OTP" value={form.otp} onChange={(e) => setForm({ ...form, otp: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputProps={{ inputMode: 'numeric' }} autoFocus />
          <Button variant="contained" size="large" onClick={verify} disabled={busy || form.otp.length !== 6}>Verify OTP</Button>
          <Button onClick={submit} disabled={busy || resendSeconds > 0}>{resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : 'Resend WhatsApp code'}</Button>
          <Button onClick={() => setChallenge(null)}>Start again</Button>
        </>}
      </Stack>
    </Paper>
  </Box>;
}

export function StudentPortalGuard() {
  return localStorage.getItem('studentPortalToken') ? <Outlet /> : <Navigate to="/student/login" replace />;
}

const nav = [
  ['/student/dashboard', 'Dashboard', <DashboardIcon />],
  ['/student/lessons', 'Lessons', <MenuBookIcon />],
  ['/student/materials', 'Materials', <FolderCopyIcon />],
  ['/student/payments', 'Payments', <PaymentsIcon />],
  ['/student/profile', 'Profile', <PersonIcon />]
];

export function StudentPortalLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  return <Box sx={{ minHeight: '100vh', bgcolor: '#f5f8f7', pb: { xs: 9, sm: 3 } }}>
    <AppBar position="sticky" elevation={0} sx={{ bgcolor: '#0b3d32' }}>
      <Toolbar><SchoolIcon sx={{ mr: 1 }} /><Typography fontWeight={900} sx={{ flex: 1 }}>Student LMS</Typography><Button color="inherit" onClick={() => { localStorage.removeItem('studentPortalToken'); navigate('/student/login'); }}>Logout</Button></Toolbar>
    </AppBar>
    <Container maxWidth="lg" sx={{ py: 3 }}><Outlet /></Container>
    <Paper elevation={5} sx={{ display: { xs: 'flex', sm: 'none' }, position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 10, justifyContent: 'space-around' }}>
      {nav.map(([path, label, icon]) => <Button key={path} component={Link} to={path} color={location.pathname.startsWith(path) ? 'primary' : 'inherit'} sx={{ py: 1, minWidth: 70, flexDirection: 'column', fontSize: 10 }}>{icon}{label}</Button>)}
    </Paper>
    <Paper variant="outlined" sx={{ display: { xs: 'none', sm: 'block' }, position: 'fixed', left: 20, top: 90, p: 1, zIndex: 2 }}>
      <Stack>{nav.map(([path, label, icon]) => <Button key={path} component={Link} to={path} startIcon={icon} sx={{ justifyContent: 'flex-start' }} variant={location.pathname.startsWith(path) ? 'contained' : 'text'}>{label}</Button>)}</Stack>
    </Paper>
  </Box>;
}

function PageLoading() { return <Box sx={{ py: 10, textAlign: 'center' }}><CircularProgress /></Box>; }
function PaymentBanner({ access }) { return access?.warning ? <Alert severity="warning" sx={{ mb: 2.5 }}>{access.warning}</Alert> : null; }

function EnrollmentDashboardSections({ data }) {
  return <Stack spacing={2.5}>
    <Box><Typography variant="h5" fontWeight={900} sx={{ mb: 1.5 }}>My Courses</Typography><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 2 }}>
      {(data.myCourses || []).map((item) => <Paper key={item.enrollmentId} elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: item.accessAllowed ? 'success.light' : 'warning.light', borderRadius: 3 }}><Stack direction="row" justifyContent="space-between" spacing={2}><Box><Typography variant="h6" fontWeight={900}>{item.course?.name || 'Course'}</Typography><Typography color="text.secondary">{item.batch?.name || 'All batches'}</Typography></Box><SchoolIcon color="primary" /></Stack><Stack direction="row" spacing={1} sx={{ my: 1.5 }}><Chip size="small" color="success" label="Active" /><Chip size="small" color={item.accessAllowed ? 'success' : 'warning'} label={item.accessAllowed ? 'Access allowed' : 'Access blocked'} /></Stack><Button component={Link} to={item.viewLessonsUrl || '/student/lessons'} variant="outlined" size="small">View Lessons</Button></Paper>)}
      {!data.myCourses?.length && <Paper variant="outlined" sx={{ p: 3 }}>No active courses.</Paper>}
    </Box></Box>
    <Box><Typography variant="h5" fontWeight={900} sx={{ mb: 1.5 }}>Upcoming Classes</Typography><Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3 }}>
      <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: '1.2fr .8fr 1.4fr 1fr .8fr 1fr', gap: 2, px: 2, py: 1.25, bgcolor: 'action.hover' }}>{['Date', 'Time', 'Course', 'Batch', 'Status', 'Action'].map((label) => <Typography key={label} variant="caption" fontWeight={850}>{label}</Typography>)}</Box>
      {(data.upcomingClasses || []).map((lesson) => { const date = new Date(lesson.liveClassAt); return <Box key={lesson.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.2fr .8fr 1.4fr 1fr .8fr 1fr' }, gap: { xs: .5, md: 2 }, alignItems: 'center', px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}><Typography>{date.toLocaleDateString()}</Typography><Typography>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Typography><Typography fontWeight={750}>{lesson.course?.name}</Typography><Typography>{lesson.batch?.name || 'All batches'}</Typography><ClassStatusChip lesson={lesson} /><JoinButton lesson={lesson} /></Box>; })}
      {!data.upcomingClasses?.length && <Typography sx={{ p: 3 }} color="text.secondary">No upcoming live classes.</Typography>}
    </Paper></Box>
  </Stack>;
}

function ClassStatusChip({ lesson }) {
  const status = lesson.classStatus || 'completed';
  return <Chip size="small" color={status === 'live_now' ? 'error' : status === 'upcoming' ? 'info' : 'default'} label={status === 'live_now' ? 'Live' : status === 'upcoming' ? 'Upcoming' : 'Completed'} />;
}

export function StudentDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { getStudentDashboard().then((res) => setData(res.data.data)).catch((e) => setError(e.response?.data?.message || 'Unable to load dashboard.')); }, []);
  if (!data && !error) return <PageLoading />;
  if (error) return <Alert severity="error">{error}</Alert>;
  const student = data.student;
  return <Stack spacing={2.5} sx={{ ml: { sm: 20 } }}>
    <Box sx={{ pt: 1 }}><Typography variant="body1" color="text.secondary">Welcome back,</Typography><Typography variant="h3" fontWeight={950}>{student.name}</Typography><Typography color="text.secondary">Here is what is happening across your courses.</Typography></Box>
    <PaymentBanner access={data.paymentAccess} />
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
      {[['My Courses', data.myCourses?.length || 0], ['My Batches', data.myBatches?.length || 0], ['Upcoming Classes', data.upcomingClasses?.length || 0], ['Pending Payments', (data.paymentAccess.enrollments || []).filter((item) => !item.allowed).length]].map(([label, value]) => <Paper elevation={0} sx={{ p: 2.25, border: '1px solid', borderColor: 'divider', borderRadius: 3 }} key={label}><Typography color="text.secondary" variant="body2">{label}</Typography><Typography variant="h4" fontWeight={950}>{value}</Typography></Paper>)}
    </Box>
    <EnrollmentDashboardSections data={data} />
    <Box><Typography variant="h5" fontWeight={900} sx={{ mb: 1.5 }}>Recent Lessons</Typography><LessonCards lessons={data.recentLessons} /></Box>
    <Box><Typography variant="h5" fontWeight={900} sx={{ mb: 1.5 }}>Recent Recordings</Typography><LessonCards lessons={data.latestRecordings} empty="No recordings available yet." /></Box>
  </Stack>;
}

function LessonCards({ lessons, empty = 'No lessons available.' }) {
  if (!lessons?.length) return <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>{empty}</Paper>;
  return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 2 }}>{lessons.map((lesson) => <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3 }} key={lesson.id}>
    <CardActionArea component={Link} to={`/student/lessons/${lesson.id}`}><CardContent><Stack direction="row" justifyContent="space-between"><ClassStatusChip lesson={lesson} /><Typography variant="caption">{lesson.durationMinutes ? `${lesson.durationMinutes} min` : ''}</Typography></Stack><Typography variant="h6" fontWeight={900} sx={{ mt: 1 }}>{lesson.title}</Typography><Typography variant="body2" color="text.secondary" sx={{ minHeight: 40 }}>{lesson.description || 'Course lesson'}</Typography><Stack direction="row" spacing={.75} sx={{ mt: 1.5 }}><Chip size="small" color="primary" label={lesson.course?.name || 'Course'} /><Chip size="small" variant="outlined" label={lesson.batch?.name || 'All batches'} /></Stack><LinearProgress variant="determinate" value={Number(lesson.progress?.watchedPercentage || 0)} sx={{ mt: 2 }} /><Typography variant="caption">{Math.round(lesson.progress?.watchedPercentage || 0)}% watched</Typography></CardContent></CardActionArea>
    <Box sx={{ px: 2, pb: 2 }}>{lesson.liveClassAt && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{new Date(lesson.liveClassAt).toLocaleString()}</Typography>}<Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>{lesson.hasLiveClass && <JoinButton lesson={lesson} />}{lesson.hasRecording && <Button component={Link} to={`/student/lessons/${lesson.id}`} size="small">Watch Recording</Button>}<Button component={Link} to={`/student/lessons/${lesson.id}#materials`} size="small">View Materials</Button></Stack></Box>
  </Card>)}</Box>;
}

function JoinButton({ lesson }) {
  const [error, setError] = useState('');
  const join = async () => {
    try {
      setError('');
      const response = await joinStudentLiveClass(lesson.id);
      window.open(response.data.data.liveClassUrl || response.data.data.zoomLink, '_blank', 'noopener,noreferrer');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to join this class.');
    }
  };
  if (!lesson.canJoin) {
    const label = lesson.joinStatus === 'payment_blocked' ? 'Payment required'
      : lesson.classStatus === 'completed' ? 'Class ended' : 'Upcoming';
    return <Stack alignItems={{ sm: 'flex-end' }} spacing={0.5}><Chip label={label} color={lesson.joinStatus === 'payment_blocked' ? 'warning' : 'default'} />{lesson.joinMessage && <Typography variant="caption" color="text.secondary">{lesson.joinMessage}</Typography>}</Stack>;
  }
  return <Stack alignItems={{ sm: 'flex-end' }} spacing={0.5}><Button variant="contained" color="success" startIcon={<VideoCallIcon />} onClick={join}>{lesson.joinButtonLabel || 'Join Live Class'}</Button>{error && <Typography variant="caption" color="error">{error}</Typography>}</Stack>;
}

export function StudentLessonsPage() {
  const [lessons, setLessons] = useState(null);
  const [error, setError] = useState('');
  const [courseId, setCourseId] = useState('all');
  const [batchId, setBatchId] = useState('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  useEffect(() => { getStudentLessons().then((res) => setLessons(res.data.data)).catch((e) => setError(e.response?.data?.message || 'Unable to load lessons.')); }, []);
  const courses = useMemo(() => [...new Map((lessons || []).filter((item) => item.course).map((item) => [String(item.course.id), item.course])).values()], [lessons]);
  const batches = useMemo(() => [...new Map((lessons || []).filter((item) => item.batch && (courseId === 'all' || String(item.course?.id) === courseId)).map((item) => [String(item.batch.id), item.batch])).values()], [lessons, courseId]);
  const filtered = useMemo(() => (lessons || []).filter((lesson) => {
    if (courseId !== 'all' && String(lesson.course?.id) !== courseId) return false;
    if (batchId !== 'all' && String(lesson.batch?.id || '') !== batchId) return false;
    if (status !== 'all' && lesson.classStatus !== status && !(status === 'recording' && lesson.hasRecording)) return false;
    return !search || `${lesson.title} ${lesson.description || ''}`.toLowerCase().includes(search.toLowerCase());
  }), [lessons, courseId, batchId, status, search]);
  const groups = useMemo(() => {
    const result = [];
    filtered.forEach((lesson) => {
      let course = result.find((item) => String(item.id) === String(lesson.course?.id));
      if (!course) { course = { id: lesson.course?.id || 'course', name: lesson.course?.name || 'Course', batches: [] }; result.push(course); }
      const key = lesson.batch?.id || 'all';
      let batch = course.batches.find((item) => String(item.id) === String(key));
      if (!batch) { batch = { id: key, name: lesson.batch?.name || 'All Batches', lessons: [] }; course.batches.push(batch); }
      batch.lessons.push(lesson);
    });
    return result;
  }, [filtered]);
  return <Stack spacing={2.5} sx={{ ml: { sm: 20 } }}>
    <Box><Typography variant="h3" fontWeight={950}>Lessons</Typography><Typography color="text.secondary">Browse live classes, recordings, and materials by course and batch.</Typography></Box>
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap"><Button variant={courseId === 'all' ? 'contained' : 'outlined'} onClick={() => { setCourseId('all'); setBatchId('all'); }}>All</Button>{courses.map((course) => <Button key={course.id} variant={courseId === String(course.id) ? 'contained' : 'outlined'} onClick={() => { setCourseId(String(course.id)); setBatchId('all'); }}>{course.name}</Button>)}</Stack>
    <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr 1.4fr' }, gap: 1.5 }}>
      <TextField select size="small" label="Course Filter" value={courseId} onChange={(e) => { setCourseId(e.target.value); setBatchId('all'); }}><MenuItem value="all">All Courses</MenuItem>{courses.map((course) => <MenuItem value={String(course.id)} key={course.id}>{course.name}</MenuItem>)}</TextField>
      <TextField select size="small" label="Batch Filter" value={batchId} onChange={(e) => setBatchId(e.target.value)}><MenuItem value="all">All Batches</MenuItem>{batches.map((batch) => <MenuItem value={String(batch.id)} key={batch.id}>{batch.name}</MenuItem>)}</TextField>
      <TextField select size="small" label="Status Filter" value={status} onChange={(e) => setStatus(e.target.value)}><MenuItem value="all">All Statuses</MenuItem><MenuItem value="upcoming">Upcoming</MenuItem><MenuItem value="live_now">Live</MenuItem><MenuItem value="completed">Completed</MenuItem><MenuItem value="recording">Has Recording</MenuItem></TextField>
      <TextField size="small" label="Search lessons" value={search} onChange={(e) => setSearch(e.target.value)} />
    </Box></Paper>
    {error ? <Alert severity={error.includes('payment') ? 'warning' : 'error'}>{error}</Alert> : !lessons ? <PageLoading /> : groups.length ? groups.map((course) => <Box key={course.id}><Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}><SchoolIcon color="primary" /><Typography variant="h4" fontWeight={950}>{course.name}</Typography></Stack><Stack spacing={2}>{course.batches.map((batch) => <Box key={batch.id}><Typography variant="h6" fontWeight={850} color="text.secondary" sx={{ mb: 1 }}>{batch.name}</Typography><LessonCards lessons={batch.lessons} /></Box>)}</Stack></Box>) : <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>No lessons match these filters.</Paper>}
  </Stack>;
}

export function StudentLessonPage() {
  const { id } = useParams();
  const [lesson, setLesson] = useState(null);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const loadLesson = () => getStudentLesson(id).then((res) => setLesson(res.data.data)).catch((e) => setError(e.response?.data?.message || 'Unable to open lesson.'));
  useEffect(() => { loadLesson(); }, [id]);
  if (error) return <Alert severity="warning" sx={{ ml: { sm: 20 } }}>{error}</Alert>;
  if (!lesson) return <PageLoading />;
  const updateVideo = (event) => {
    const video = event.currentTarget;
    if (!video.duration) return;
    updateStudentProgress(id, { lastWatchedSeconds: Math.floor(video.currentTime), watchedPercentage: video.currentTime / video.duration * 100 });
  };
  return <Stack spacing={2.5} sx={{ ml: { sm: 20 } }}>
    <Box><Button component={Link} to="/student/lessons">← Lessons</Button><Typography variant="h3" fontWeight={950}>{lesson.title}</Typography><Stack direction="row" spacing={1} sx={{ mt: 1 }}><Chip color="primary" label={lesson.course?.name || 'Course'} /><Chip variant="outlined" label={lesson.batch?.name || 'All batches'} /><ClassStatusChip lesson={lesson} /></Stack></Box>
    <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}><Typography variant="h6" fontWeight={900}>Description</Typography><Typography sx={{ whiteSpace: 'pre-wrap', mt: 1 }}>{lesson.description || 'No lesson description.'}</Typography></Paper>
    {lesson.accessStatus === 'payment_blocked' && <Alert severity="warning">{lesson.accessWarning || paymentWarning}</Alert>}
    {lesson.hasLiveClass && <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: lesson.classStatus === 'live_now' ? 'error.main' : 'info.light', borderRadius: 3 }}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2}><Box><Typography variant="h6" fontWeight={900}>Live Class Information</Typography><Typography color="text.secondary">{new Date(lesson.liveClassAt).toLocaleString()}</Typography></Box><JoinButton lesson={lesson} /></Stack></Paper>}
    <Box><Typography variant="h5" fontWeight={900} sx={{ mb: 1 }}>Recording</Typography>{lesson.bunnyEmbedUrl && <Box sx={{ position: 'relative', pt: '56.25%', bgcolor: '#000', borderRadius: 3, overflow: 'hidden' }}><iframe title={lesson.title} src={lesson.bunnyEmbedUrl} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen onLoad={() => updateStudentProgress(id, { watchedPercentage: 1 })} style={{ position: 'absolute', inset: 0, border: 0, width: '100%', height: '100%' }} /></Box>}{!lesson.bunnyEmbedUrl && lesson.recordingUrl && <Box component="video" controls src={lesson.recordingUrl} onTimeUpdate={updateVideo} sx={{ width: '100%', maxHeight: 620, bgcolor: '#000', borderRadius: 3 }} />}{!lesson.hasRecording && <Paper variant="outlined" sx={{ p: 3 }}><Typography color="text.secondary">No recording is available yet.</Typography></Paper>}</Box>
    <Paper id="materials" elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}><Typography variant="h5" fontWeight={900}>Materials & Downloads</Typography><Stack divider={<Divider />} sx={{ mt: 1 }}>{(lesson.materials || []).map((item) => <Button key={item.id} component="a" href={assetUrl(item.fileUrl)} target="_blank" rel="noopener noreferrer" download startIcon={<DownloadIcon />} sx={{ justifyContent: 'flex-start', py: 1.5 }}>{item.title} {item.materialType || item.fileType ? `(${item.materialType || item.fileType})` : ''}</Button>)}{!lesson.materials?.length && <Typography color="text.secondary" sx={{ py: 2 }}>No materials for this lesson.</Typography>}</Stack></Paper>
    {lesson.accessStatus === 'available' && <Button sx={{ alignSelf: 'flex-start' }} variant="outlined" onClick={async () => { await updateStudentProgress(id, { watchedPercentage: 100, isCompleted: true }); setLesson({ ...lesson, progress: { ...lesson.progress, watchedPercentage: 100, isCompleted: true } }); }}>Mark lesson complete</Button>}
    <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}><Typography variant="h5" fontWeight={900}>Comments / Q&A</Typography><Stack spacing={1.5} sx={{ mt: 2 }}>{(lesson.comments || []).map((item) => <Box key={item.id} sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 2 }}><Typography fontWeight={800}>{item.student?.name || 'Student'}</Typography><Typography>{item.comment}</Typography><Typography variant="caption" color="text.secondary">{new Date(item.createdAt).toLocaleString()}</Typography></Box>)}{!lesson.comments?.length && <Typography color="text.secondary">No questions yet. Start the conversation.</Typography>}<TextField label="Ask a question or leave a comment" value={comment} onChange={(e) => setComment(e.target.value)} multiline minRows={2} /><Button variant="contained" disabled={!comment.trim()} onClick={async () => { await addStudentLessonComment(id, { comment }); setComment(''); await loadLesson(); }} sx={{ alignSelf: 'flex-start' }}>Post Comment</Button></Stack></Paper>
  </Stack>;
}

export function StudentMaterialsPage() {
  const [materials, setMaterials] = useState(null);
  const [error, setError] = useState('');
  const [courseId, setCourseId] = useState('all');
  const [batchId, setBatchId] = useState('all');
  const [type, setType] = useState('all');
  useEffect(() => { getStudentMaterials().then((response) => setMaterials(response.data.data)).catch((requestError) => setError(requestError.response?.data?.message || 'Unable to load materials.')); }, []);
  const courses = useMemo(() => [...new Map((materials || []).filter((item) => item.course).map((item) => [String(item.course.id), item.course])).values()], [materials]);
  const batches = useMemo(() => [...new Map((materials || []).filter((item) => item.batch && (courseId === 'all' || String(item.course?.id) === courseId)).map((item) => [String(item.batch.id), item.batch])).values()], [materials, courseId]);
  const types = useMemo(() => [...new Set((materials || []).map((item) => item.materialType || item.fileType).filter(Boolean))], [materials]);
  const filtered = useMemo(() => (materials || []).filter((item) => (
    (courseId === 'all' || String(item.course?.id) === courseId)
    && (batchId === 'all' || String(item.batch?.id || '') === batchId)
    && (type === 'all' || (item.materialType || item.fileType) === type)
  )), [materials, courseId, batchId, type]);
  return <Stack spacing={2.5} sx={{ ml: { sm: 20 } }}>
    <Box><Typography variant="h3" fontWeight={950}>Materials</Typography><Typography color="text.secondary">Resources published for your active courses and batches.</Typography></Box>
    <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}><TextField select size="small" label="Course" value={courseId} onChange={(e) => { setCourseId(e.target.value); setBatchId('all'); }}><MenuItem value="all">All Courses</MenuItem>{courses.map((course) => <MenuItem key={course.id} value={String(course.id)}>{course.name}</MenuItem>)}</TextField><TextField select size="small" label="Batch" value={batchId} onChange={(e) => setBatchId(e.target.value)}><MenuItem value="all">All Batches</MenuItem>{batches.map((batch) => <MenuItem key={batch.id} value={String(batch.id)}>{batch.name}</MenuItem>)}</TextField><TextField select size="small" label="Material Type" value={type} onChange={(e) => setType(e.target.value)}><MenuItem value="all">All Types</MenuItem>{types.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField></Box></Paper>
    {error ? <Alert severity="error">{error}</Alert> : !materials ? <PageLoading /> : <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 2 }}>{filtered.map((item) => <Paper key={item.id} elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}><Stack direction="row" spacing={1.5}><FolderCopyIcon color="primary" sx={{ fontSize: 38 }} /><Box sx={{ minWidth: 0 }}><Chip size="small" label={item.materialType || item.fileType || 'Material'} /><Typography variant="h6" fontWeight={900} sx={{ mt: .5 }}>{item.title}</Typography><Typography variant="body2" color="text.secondary">{item.course?.name} · {item.batch?.name || 'All batches'}</Typography><Typography variant="body2" sx={{ mt: 1 }}>{item.description || item.lesson?.title}</Typography></Box></Stack><Button fullWidth variant="contained" startIcon={<DownloadIcon />} component="a" href={assetUrl(item.fileUrl)} target="_blank" rel="noopener noreferrer" sx={{ mt: 2 }}>Download</Button></Paper>)}{!filtered.length && <Paper variant="outlined" sx={{ p: 4 }}><Typography color="text.secondary">No materials match these filters.</Typography></Paper>}</Box>}
  </Stack>;
}

export function StudentPaymentsPage() {
  const [data, setData] = useState(null);
  useEffect(() => { getStudentPayments().then((res) => setData(res.data.data)); }, []);
  if (!data) return <PageLoading />;
  return <Stack spacing={2.5} sx={{ ml: { sm: 20 } }}><Typography variant="h4" fontWeight={900}>Payments & Access</Typography><PaymentBanner access={data} />{data.allowed && <Alert severity="success">At least one course is available.</Alert>}{data.enrollments.map((enrollment) => <Paper key={enrollment.enrollmentId} variant="outlined" sx={{ p: 2.5, borderColor: enrollment.allowed ? 'success.light' : 'warning.main' }}><Stack direction="row" justifyContent="space-between" alignItems="flex-start"><Box><Typography fontWeight={850}>{enrollment.course?.name || 'Course'}</Typography><Typography variant="body2" color="text.secondary">{enrollment.batch?.name || 'All batches'}</Typography></Box><Chip size="small" color={enrollment.allowed ? 'success' : 'warning'} label={enrollment.allowed ? 'Access active' : 'Access blocked'} /></Stack>{enrollment.fee ? <><Typography sx={{ mt: 1 }}>Payment plan: {enrollment.fee.paymentType}</Typography><Typography>Total: {enrollment.fee.totalAmount} · Paid: {enrollment.fee.paidAmount} · Balance: {enrollment.fee.balance}</Typography><Stack sx={{ mt: 2 }} divider={<Divider />}>{enrollment.fee.installments.map((item) => <Stack key={item.id} direction="row" justifyContent="space-between" sx={{ py: 1 }}><Typography>Installment {item.installmentNo} · due {item.dueDate}</Typography><Chip size="small" label={item.status} color={['paid', 'confirmed'].includes(item.status) ? 'success' : item.status === 'overdue' ? 'error' : 'default'} /></Stack>)}</Stack></> : <Alert severity="warning" sx={{ mt: 1.5 }}>No payment plan is linked to this enrollment.</Alert>}</Paper>)}</Stack>;
}

export function StudentProfilePage() {
  const [data, setData] = useState(null);
  useEffect(() => { getStudentMe().then((res) => setData(res.data.data)); }, []);
  if (!data) return <PageLoading />;
  const student = data.student;
  return <Stack spacing={2.5} sx={{ ml: { sm: 20 } }}><Typography variant="h4" fontWeight={900}>My Profile</Typography><PaymentBanner access={data.paymentAccess} /><Paper variant="outlined" sx={{ p: 3 }}><Stack spacing={1.5}>{[['Registration number', student.studentNo], ['Name', student.name], ['Phone', student.phone], ['Email', student.email || '-'], ['Course', student.course?.name || '-'], ['Batch', student.batch?.name || '-'], ['Status', student.status]].map(([label, value]) => <Box key={label}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography fontWeight={750}>{value}</Typography></Box>)}</Stack></Paper></Stack>;
}
